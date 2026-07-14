import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { MantisRestClient } from '../mantis.js';
import { handler, jsonResult } from './shared.js';

type ViewState = 'public' | 'private';

/**
 * Posts a note to an issue and returns the created note (enriched with view_url
 * when the id is known). Shared by add_note, update_issue and resolve_issue.
 */
export async function postNote(
  client: MantisRestClient,
  issueId: number,
  text: string,
  viewState: ViewState,
): Promise<Record<string, unknown>> {
  const body = { text, view_state: { name: viewState } };
  const raw = await client.post<Record<string, unknown>>(`/issues/${issueId}/notes`, body);
  const note = (raw.note ?? raw) as Record<string, unknown>;
  const noteId = note.id;
  if (typeof noteId === 'number') {
    return { ...note, view_url: client.buildNoteViewUrl(issueId, noteId) };
  }
  return note;
}

export function registerNoteTools(server: McpServer, client: MantisRestClient): void {
  server.registerTool(
    'mantis_add_note',
    {
      title: 'Add note to issue',
      description:
        'Adds a note (comment) to an issue. Use private=true for an internal note visible only to ' +
        'developers/managers. To change a field and comment in one call, use mantis_update_issue with its "note" parameter instead.',
      inputSchema: {
        issue_id: z.number().int().positive().describe('Numeric issue id.'),
        text: z.string().min(1).describe('Note body (plain text or Markdown).'),
        private: z.boolean().optional().describe('Create as a private note (default false).'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    handler(async ({ issue_id, text, private: priv }) =>
      jsonResult(await postNote(client, issue_id, text, priv ? 'private' : 'public')),
    ),
  );
}
