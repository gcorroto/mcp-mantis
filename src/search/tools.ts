import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { MantisRestClient } from '../mantis.js';
import {
  dateFilterSchema,
  hasDateFilter,
  matchesDateFilter,
  type DateFilter,
} from '../date-filter.js';
import { handler, jsonResult, runWithConcurrency } from '../tools/shared.js';
import type { Embedder } from './embedder.js';
import { extractSnippet, extractTerms, hasTermMatch, highlightText } from './highlight.js';
import type { VectorStore } from './store.js';
import { SearchSyncService } from './sync.js';

const coerceBool = (val: unknown) => (val === 'true' ? true : val === 'false' ? false : val);

function buildHighlights(
  summary: string | undefined,
  description: string | undefined,
  terms: string[],
): Record<string, string> | null {
  const h: Record<string, string> = {};
  if (summary) {
    const highlighted = highlightText(summary, terms);
    if (highlighted !== summary) h.summary = highlighted;
  }
  if (description && hasTermMatch(description, terms)) {
    h.description = extractSnippet(description, terms);
  }
  return Object.keys(h).length > 0 ? h : null;
}

export function registerSearchTools(
  server: McpServer,
  client: MantisRestClient,
  store: VectorStore,
  embedder: Embedder,
): void {
  server.registerTool(
    'mantis_search_issues',
    {
      title: 'Semantic issue search',
      description:
        'Search issues by natural-language meaning (not keywords), useful to find similar/duplicate incidents. ' +
        'The index must be built first with mantis_rebuild_search_index. Without "select" only id+score are returned.',
      inputSchema: {
        query: z.string().min(1).describe('Natural-language query.'),
        top_n: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .describe('Results to return (default 10, max 50).'),
        select: z
          .string()
          .optional()
          .describe(
            'Comma-separated fields to fetch per result, e.g. "id,summary,status,handler".',
          ),
        highlight: z
          .preprocess(coerceBool, z.boolean().optional())
          .describe('If true, add a "highlights" field with query terms bolded.'),
        ...dateFilterSchema,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    handler(
      async ({
        query,
        top_n,
        select,
        highlight,
        updated_after,
        updated_before,
        created_after,
        created_before,
      }) => {
        if ((await store.count()) === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'Search index is empty. Run mantis_rebuild_search_index first.',
              },
            ],
            isError: true,
          };
        }
        const topN = top_n ?? 10;
        const dateFilter: DateFilter = {
          updated_after,
          updated_before,
          created_after,
          created_before,
        };
        const filterActive = hasDateFilter(dateFilter);
        const terms = highlight ? extractTerms(query) : [];
        const queryVector = await embedder.embed(query);

        // When a date filter is active we cannot know upfront how many top-scored
        // candidates survive it, so rank the whole index and date-filter using the
        // (cheap, in-memory) store metadata, stopping once topN survivors are found.
        const ranked = await store.search(
          queryVector,
          filterActive ? Number.MAX_SAFE_INTEGER : topN,
        );
        const candidates: Array<{ id: number; score: number }> = [];
        for (const r of ranked) {
          if (filterActive) {
            const item = await store.getItem(r.id);
            if (!matchesDateFilter(item?.metadata ?? {}, dateFilter)) continue;
          }
          candidates.push(r);
          if (candidates.length >= topN) break;
        }

        if (!select) {
          const out = await runWithConcurrency(candidates, 8, async ({ id, score }) => {
            const item = terms.length ? await store.getItem(id) : null;
            const result: Record<string, unknown> = {
              id,
              score,
              view_url: client.buildIssueViewUrl(id),
            };
            if (terms.length && item) {
              const h = buildHighlights(item.metadata.summary, item.metadata.description, terms);
              if (h) result.highlights = h;
            }
            return result;
          });
          return jsonResult(out);
        }

        const fields = select
          .split(',')
          .map((f) => f.trim())
          .filter(Boolean);
        // Bounded HTTP fan-out: at most topN fetches, 5 concurrent (matches mantis_get_issues).
        const enriched = await runWithConcurrency(candidates, 5, async ({ id, score }) => {
          const base: Record<string, unknown> = {
            id,
            score,
            view_url: client.buildIssueViewUrl(id),
          };
          try {
            const issueResult = await client.get<{ issues?: Array<Record<string, unknown>> }>(
              `/issues/${id}`,
            );
            const issue = issueResult.issues?.[0] ?? {};
            for (const field of fields) {
              if (field !== 'id' && field in issue) base[field] = issue[field];
            }
            if (terms.length) {
              const summary = typeof issue.summary === 'string' ? issue.summary : undefined;
              const description =
                typeof issue.description === 'string' ? issue.description : undefined;
              const h = buildHighlights(summary, description, terms);
              if (h) base.highlights = h;
            }
          } catch {
            // keep the bare {id, score, view_url}
          }
          return base;
        });
        return jsonResult(enriched);
      },
    ),
  );

  server.registerTool(
    'mantis_search_index_status',
    {
      title: 'Search index status',
      description:
        'Fill level of the semantic index: indexed vs. total issues, plus last sync timestamp.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    handler(async () => {
      const [indexed, lastSyncedAt, total] = await Promise.all([
        store.count(),
        store.getLastSyncedAt(),
        store.getLastKnownTotal(),
      ]);
      const percent = total !== null ? (total > 0 ? Math.round((indexed / total) * 100) : 0) : null;
      const summary =
        total !== null ? `${indexed}/${total} (${percent}%)` : `${indexed}/? (total unknown)`;
      return jsonResult({ summary, indexed, total, percent, last_synced_at: lastSyncedAt });
    }),
  );

  server.registerTool(
    'mantis_rebuild_search_index',
    {
      title: 'Rebuild semantic search index',
      description:
        'Builds/updates the semantic search index from Mantis issues. Use full=true to clear and rebuild from scratch. First run downloads the embedding model (may take a minute).',
      inputSchema: {
        project_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Only index issues from this project.'),
        full: z
          .preprocess(coerceBool, z.boolean().optional())
          .describe('Clear the index and rebuild (default false).'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    handler(async ({ project_id, full }) => {
      if (full) {
        await store.clear();
        await store.resetLastSyncedAt();
      }
      const startMs = Date.now();
      const service = new SearchSyncService(client, store, embedder);
      const { indexed, skipped, total } = await service.sync(project_id);
      return jsonResult({ indexed, skipped, total, duration_ms: Date.now() - startMs });
    }),
  );
}
