import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { EnumGroup } from '../constants.js';
import type { MantisRestClient } from '../mantis.js';
import {
  dateFilterSchema,
  hasDateFilter,
  matchesDateFilter,
  type DateFilter,
} from '../date-filter.js';
import { postNote } from './notes.js';
import {
  customFieldEntry,
  enrichIssue,
  handler,
  jsonResult,
  ref,
  runWithConcurrency,
  unwrapIssue,
} from './shared.js';

type Issue = Record<string, unknown> & {
  id?: number;
  status?: { id?: number; name?: string };
  handler?: { id?: number };
  reporter?: { id?: number };
  project?: { id?: number };
  updated_at?: string;
  created_at?: string;
};

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false } as const;

const ENUM_REF_FIELDS: EnumGroup[] = [
  'status',
  'priority',
  'severity',
  'resolution',
  'reproducibility',
];

const coerceBool = (val: unknown) => (val === 'true' ? true : val === 'false' ? false : val);

// Lightweight default projection for list_issues — omits the heavy notes/attachments/history
// arrays (a full listing of those blows past tool output limits; use mantis_get_issue for detail).
const LIST_DEFAULT_FIELDS = [
  'id',
  'summary',
  'status',
  'handler',
  'reporter',
  'priority',
  'severity',
  'category',
  'project',
  'resolution',
  'updated_at',
  'created_at',
];

// Fields each fetched issue must carry for the client-side filters to work.
const FILTER_REQUIRED_FIELDS = ['id', 'handler', 'reporter', 'status', 'updated_at', 'created_at'];

// Builds the `select` sent to the API: the caller's fields (or the lightweight default),
// always union the fields the active client-side filters depend on so filtering can't silently
// match nothing when the caller omits e.g. `handler`.
function buildApiSelect(userFields: string[] | null, needsClientFilter: boolean): string {
  const set = new Set(userFields ?? LIST_DEFAULT_FIELDS);
  set.add('id');
  if (needsClientFilter) for (const f of FILTER_REQUIRED_FIELDS) set.add(f);
  return [...set].join(',');
}

// Projects an issue down to the caller's requested fields (always keeping id + view_url), so the
// extra fields forced in for filtering do not leak into the output when the caller asked for a subset.
function projectIssue(
  client: MantisRestClient,
  issue: Issue,
  fields: string[],
): Record<string, unknown> {
  const source = issue as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of fields) if (f in source) out[f] = source[f];
  if (issue.id !== undefined) {
    out.id = issue.id;
    out.view_url = client.buildIssueViewUrl(issue.id);
  }
  return out;
}

// Resolves enum {name} refs to {id} in-place on a patch object.
async function resolveEnumRefs(
  client: MantisRestClient,
  patch: Record<string, unknown>,
): Promise<void> {
  for (const group of ENUM_REF_FIELDS) {
    const val = patch[group] as { id?: number; name?: string } | undefined;
    if (val?.name !== undefined && val.id === undefined) {
      patch[group] = { id: await client.resolveEnumId(group, val.name) };
    }
  }
}

const fieldsSchema = z
  .object({
    summary: z.string().optional(),
    description: z.string().optional(),
    steps_to_reproduce: z.string().optional(),
    additional_information: z.string().optional(),
    status: ref.optional(),
    resolution: ref.optional(),
    priority: ref.optional(),
    severity: ref.optional(),
    reproducibility: ref.optional(),
    handler: ref.optional(),
    category: ref.optional(),
    version: ref.optional(),
    target_version: ref.optional(),
    fixed_in_version: ref.optional(),
    view_state: ref.optional(),
    custom_fields: z.array(customFieldEntry).optional(),
  })
  .strict();

export function registerIssueTools(server: McpServer, client: MantisRestClient): void {
  // --- get_issue ----------------------------------------------------------
  server.registerTool(
    'mantis_get_issue',
    {
      title: 'Get issue',
      description:
        'Returns one issue by id with every field: description, steps to reproduce, notes, attachments, relationships, custom fields and history. Notes are always included.',
      inputSchema: {
        issue_id: z.number().int().positive().describe('Numeric issue id, e.g. 1239.'),
        select: z
          .string()
          .optional()
          .describe(
            'Comma-separated fields to include (server-side projection), e.g. "id,summary,status,notes".',
          ),
      },
      annotations: READ_ONLY,
    },
    handler(async ({ issue_id, select }) => {
      const result = await client.get<{ issues?: Issue[] }>(`/issues/${issue_id}`, { select });
      return jsonResult(enrichIssue(client, unwrapIssue(result, issue_id)));
    }),
  );

  // --- get_issues (batch) -------------------------------------------------
  server.registerTool(
    'mantis_get_issues',
    {
      title: 'Get multiple issues',
      description:
        'Fetch several issues by id in one call (max 5 concurrent). Missing/inaccessible ids return null at their position instead of failing the whole call. Includes requested/found/failed counters.',
      inputSchema: {
        ids: z
          .array(z.number().int().positive())
          .min(1)
          .max(50)
          .describe('Issue ids to fetch (1–50).'),
      },
      annotations: READ_ONLY,
    },
    handler(async ({ ids }) => {
      const raw = await runWithConcurrency(ids, 5, async (id): Promise<Issue | null> => {
        try {
          const result = await client.get<{ issues?: Issue[] }>(`/issues/${id}`);
          return enrichIssue(client, unwrapIssue(result, id));
        } catch {
          return null;
        }
      });
      const found = raw.filter((r) => r !== null).length;
      return jsonResult({ issues: raw, requested: ids.length, found, failed: ids.length - found });
    }),
  );

  // --- list_issues --------------------------------------------------------
  server.registerTool(
    'mantis_list_issues',
    {
      title: 'List issues',
      description:
        'List issues (newest id first). Returns a LIGHTWEIGHT summary per issue by default ' +
        '(id, summary, status, handler, reporter, priority, dates…) — call mantis_get_issue for notes/attachments/history. ' +
        'Filter server-side by project_id / stored filter_id. The status, assigned_to, reporter_id and date ' +
        'filters are applied client-side (the REST API lacks them); when active, multiple pages are scanned ' +
        '(up to 500 issues). Use status="open" for all not-yet-resolved issues. Omit project_id to span all projects.',
      inputSchema: {
        project_id: z.number().int().positive().optional(),
        filter_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Stored Mantis filter id (see mantis_list_filters).'),
        page: z.number().int().positive().optional().describe('1-based page number (default 1).'),
        page_size: z.number().int().positive().optional().describe('Issues per page (default 50).'),
        assigned_to: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Handler/assignee user id (client-side filter).'),
        reporter_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Reporter user id (client-side filter).'),
        status: z
          .string()
          .optional()
          .describe(
            'Status name (localized or canonical) or "open" for all not-yet-resolved issues (client-side).',
          ),
        select: z
          .string()
          .optional()
          .describe(
            'Comma-separated fields to include. Defaults to a lightweight summary set. ' +
              'Fields needed by the active filters are always fetched even if omitted here.',
          ),
        ...dateFilterSchema,
      },
      annotations: READ_ONLY,
    },
    handler(
      async ({
        project_id,
        filter_id,
        page = 1,
        page_size,
        assigned_to,
        reporter_id,
        status,
        select,
        updated_after,
        updated_before,
        created_after,
        created_before,
      }) => {
        const pageSize = client.clampPageSize(page_size);
        const dateFilter: DateFilter = {
          updated_after,
          updated_before,
          created_after,
          created_before,
        };
        const needsClientFilter =
          status !== undefined ||
          assigned_to !== undefined ||
          reporter_id !== undefined ||
          hasDateFilter(dateFilter);

        const userFields = select
          ? select
              .split(',')
              .map((f) => f.trim())
              .filter(Boolean)
          : null;
        const apiSelect = buildApiSelect(userFields, needsClientFilter);
        // Shape output: project to the caller's fields when given, else the lightweight default.
        const shape = (issue: Issue): Record<string, unknown> =>
          userFields ? projectIssue(client, issue, userFields) : enrichIssue(client, issue);

        if (!needsClientFilter) {
          const result = await client.get<{ issues?: Issue[] }>('/issues', {
            project_id,
            filter_id,
            select: apiSelect,
            page,
            page_size: pageSize,
          });
          return jsonResult({ issues: (result.issues ?? []).map(shape) });
        }

        // Client-side filtering: scan API pages until enough matches for page N.
        const API_PAGE_SIZE = 50;
        const MAX_API_PAGES = 10; // scan at most 500 issues
        const neededTotal = page * pageSize;
        const statusLower = status?.toLowerCase();
        const statusId =
          status !== undefined && status.toLowerCase() !== 'open'
            ? await client.resolveEnumId('status', status).catch(() => undefined)
            : undefined;
        const threshold = statusLower === 'open' ? await client.getResolvedStatusThreshold() : 0;

        const matching: Issue[] = [];
        let serverPage = 1;
        let hasMore = true;
        while (matching.length < neededTotal && serverPage <= MAX_API_PAGES && hasMore) {
          const batch = await client.get<{ issues?: Issue[] }>('/issues', {
            project_id,
            filter_id,
            select: apiSelect,
            page: serverPage,
            page_size: API_PAGE_SIZE,
          });
          const issues = batch.issues ?? [];
          hasMore = issues.length === API_PAGE_SIZE;
          for (const issue of issues) {
            if (statusLower) {
              if (!issue.status) continue;
              if (statusLower === 'open') {
                if ((issue.status.id ?? 0) >= threshold) continue;
              } else if (statusId !== undefined) {
                if (issue.status.id !== statusId) continue;
              } else if ((issue.status.name ?? '').toLowerCase() !== statusLower) {
                continue;
              }
            }
            if (assigned_to !== undefined && issue.handler?.id !== assigned_to) continue;
            if (reporter_id !== undefined && issue.reporter?.id !== reporter_id) continue;
            if (!matchesDateFilter(issue, dateFilter)) continue;
            matching.push(issue);
          }
          serverPage++;
        }
        const start = (page - 1) * pageSize;
        const pageIssues = matching.slice(start, start + pageSize).map(shape);
        return jsonResult({
          issues: pageIssues,
          scanned_pages: serverPage - 1,
          matched: matching.length,
        });
      },
    ),
  );

  // --- get_issue_attachment ----------------------------------------------
  server.registerTool(
    'mantis_get_issue_attachment',
    {
      title: 'Get issue attachment',
      description:
        'Downloads an attachment of an issue. Image attachments are returned as a viewable image; other files as base64 with metadata. Find file ids in an issue\'s "attachments" array.',
      inputSchema: {
        issue_id: z.number().int().positive(),
        file_id: z
          .number()
          .int()
          .positive()
          .describe('Attachment id from the issue "attachments" array.'),
      },
      annotations: READ_ONLY,
    },
    handler(async ({ issue_id, file_id }) => {
      const file = await client.getAttachment(issue_id, file_id);
      const meta = {
        id: file.id,
        filename: file.filename,
        size: file.size,
        content_type: file.contentType,
        issue_id,
        view_url: client.buildIssueViewUrl(issue_id),
      };
      if (file.mediaType.startsWith('image/')) {
        return {
          content: [
            { type: 'image', data: file.base64, mimeType: file.mediaType },
            { type: 'text', text: JSON.stringify(meta) },
          ],
        };
      }
      return {
        content: [
          { type: 'text', text: JSON.stringify(meta) },
          { type: 'text', text: `base64:${file.base64}` },
        ],
      };
    }),
  );

  // Write tools are only registered when not in read-only mode.
  if (client.isReadonly) return;

  // --- update_issue -------------------------------------------------------
  server.registerTool(
    'mantis_update_issue',
    {
      title: 'Update issue',
      description: `Partial update of an issue (PATCH). The "fields" object accepts any of:
- summary, description, steps_to_reproduce, additional_information (strings)
- status, resolution, priority, severity, reproducibility: { name } (localized or canonical) or { id }
- handler: { name: "<login>" } or { id }
- category, version, target_version, fixed_in_version, view_state: { name }
- custom_fields: [{ field: {id|name}, value: "<string>" }]

When resolving an issue set BOTH status and resolution (or use mantis_resolve_issue). Use "note" to append a comment (e.g. the reason for the change) in the same call. Use dry_run to preview the payload.`,
      inputSchema: {
        id: z.number().int().positive().describe('Numeric issue id to update.'),
        fields: z.preprocess((v) => {
          if (typeof v !== 'string') return v;
          try {
            return JSON.parse(v);
          } catch {
            return v;
          }
        }, fieldsSchema),
        note: z
          .string()
          .min(1)
          .optional()
          .describe('Optional note appended after a successful update.'),
        note_private: z
          .boolean()
          .optional()
          .describe('Make the appended note private (default false).'),
        dry_run: z
          .preprocess(coerceBool, z.boolean().optional())
          .describe('If true, return the patch that would be sent without applying it.'),
      },
      annotations: WRITE,
    },
    handler(async ({ id, fields, note, note_private, dry_run }) => {
      const patch: Record<string, unknown> = { ...(fields as Record<string, unknown>) };
      await resolveEnumRefs(client, patch);
      // Resolve handler login name -> id (needs the issue's project).
      const handlerRef = patch.handler as { id?: number; name?: string } | undefined;
      if (handlerRef?.name !== undefined && handlerRef.id === undefined) {
        const current = await client.get<{ issues?: Issue[] }>(`/issues/${id}`, {
          select: 'id,project',
        });
        const projectId = current.issues?.[0]?.project?.id;
        if (projectId === undefined)
          throw new Error(`Cannot resolve handler: issue ${id} has no project.`);
        patch.handler = { id: await client.resolveHandlerId(projectId, handlerRef.name) };
      }

      if (dry_run) {
        return jsonResult({ dry_run: true, id, would_patch: patch, would_add_note: note ?? null });
      }

      const result = await client.patch<{ issue?: Issue }>(`/issues/${id}`, patch);
      const response: Record<string, unknown> = { ...enrichIssue(client, unwrapIssue(result, id)) };
      if (note !== undefined) {
        // PATCH already succeeded — a note failure must not look like a failed update.
        try {
          response.note = await postNote(client, id, note, note_private ? 'private' : 'public');
        } catch (noteError) {
          const msg = noteError instanceof Error ? noteError.message : String(noteError);
          response.note_error = `Issue #${id} was updated, but adding the note failed: ${msg}. Retry with mantis_add_note.`;
        }
      }
      return jsonResult(response);
    }),
  );

  // --- resolve_issue ------------------------------------------------------
  server.registerTool(
    'mantis_resolve_issue',
    {
      title: 'Resolve issue',
      description:
        'Marks an issue as resolved by setting BOTH status and resolution in one call (avoids leaving resolution as "open"). ' +
        'Defaults: status="resuelta", resolution="fixed" — override with names valid on this instance (see mantis_get_enums). Optionally append a note.',
      inputSchema: {
        id: z.number().int().positive().describe('Numeric issue id to resolve.'),
        status: z.string().optional().describe('Target status name (default "resuelta").'),
        resolution: z.string().optional().describe('Resolution name (default "fixed").'),
        note: z.string().min(1).optional().describe('Optional note explaining the resolution.'),
        note_private: z.boolean().optional().describe('Make the note private (default false).'),
        dry_run: z
          .preprocess(coerceBool, z.boolean().optional())
          .describe('Preview without applying.'),
      },
      annotations: WRITE,
    },
    handler(async ({ id, status, resolution, note, note_private, dry_run }) => {
      const patch = {
        status: { id: await client.resolveEnumId('status', status ?? 'resuelta') },
        resolution: { id: await client.resolveEnumId('resolution', resolution ?? 'fixed') },
      };
      if (dry_run) {
        return jsonResult({ dry_run: true, id, would_patch: patch, would_add_note: note ?? null });
      }
      const result = await client.patch<{ issue?: Issue }>(`/issues/${id}`, patch);
      const response: Record<string, unknown> = { ...enrichIssue(client, unwrapIssue(result, id)) };
      if (note !== undefined) {
        try {
          response.note = await postNote(client, id, note, note_private ? 'private' : 'public');
        } catch (noteError) {
          const msg = noteError instanceof Error ? noteError.message : String(noteError);
          response.note_error = `Issue #${id} was resolved, but adding the note failed: ${msg}.`;
        }
      }
      return jsonResult(response);
    }),
  );

  // --- assign_issue -------------------------------------------------------
  server.registerTool(
    'mantis_assign_issue',
    {
      title: 'Assign issue',
      description:
        'Assigns an issue to a handler (by login name or user id) and optionally changes its status in the same call. Optionally append a note.',
      inputSchema: {
        id: z.number().int().positive().describe('Numeric issue id.'),
        handler: z
          .union([z.string(), z.number().int().positive()])
          .describe('Handler login name (resolved via project members) or numeric user id.'),
        status: z.string().optional().describe('Optional new status name (e.g. "asignada").'),
        note: z.string().min(1).optional().describe('Optional note.'),
        note_private: z.boolean().optional().describe('Make the note private (default false).'),
        dry_run: z
          .preprocess(coerceBool, z.boolean().optional())
          .describe('Preview without applying.'),
      },
      annotations: WRITE,
    },
    handler(async ({ id, handler: handlerValue, status, note, note_private, dry_run }) => {
      const current = await client.get<{ issues?: Issue[] }>(`/issues/${id}`, {
        select: 'id,project',
      });
      const projectId = current.issues?.[0]?.project?.id;
      if (projectId === undefined) throw new Error(`Cannot assign: issue ${id} has no project.`);
      const handlerId = await client.resolveHandlerId(projectId, handlerValue);
      const patch: Record<string, unknown> = { handler: { id: handlerId } };
      if (status !== undefined) patch.status = { id: await client.resolveEnumId('status', status) };

      if (dry_run) {
        return jsonResult({ dry_run: true, id, would_patch: patch, would_add_note: note ?? null });
      }
      const result = await client.patch<{ issue?: Issue }>(`/issues/${id}`, patch);
      const response: Record<string, unknown> = { ...enrichIssue(client, unwrapIssue(result, id)) };
      if (note !== undefined) {
        try {
          response.note = await postNote(client, id, note, note_private ? 'private' : 'public');
        } catch (noteError) {
          const msg = noteError instanceof Error ? noteError.message : String(noteError);
          response.note_error = `Issue #${id} was assigned, but adding the note failed: ${msg}.`;
        }
      }
      return jsonResult(response);
    }),
  );
}
