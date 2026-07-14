import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { MantisApiError, type MantisRestClient } from '../mantis.js';

/** MantisBT reference: at least one of id or name must be provided. */
export const ref = z
  .object({ id: z.number().int().optional(), name: z.string().optional() })
  .refine((o) => o.id !== undefined || o.name !== undefined, {
    message: "At least one of 'id' or 'name' must be provided",
  });

export const customFieldEntry = z.object({
  field: ref.describe('Custom field reference: { id } or { name }'),
  value: z.coerce.string().describe('Field value as string'),
});

export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(error: unknown): CallToolResult {
  let text: string;
  if (error instanceof MantisApiError) {
    const code = error.code === undefined ? '' : ` code=${error.code}`;
    text = `Mantis error (HTTP ${error.status}${code}): ${error.message}`;
  } else if (error instanceof Error) {
    text = `Error: ${error.message}`;
  } else {
    text = `Error: ${String(error)}`;
  }
  return { content: [{ type: 'text', text }], isError: true };
}

/** Wraps a handler so thrown errors become clean, model-readable tool errors. */
export function handler<A>(
  fn: (args: A) => Promise<CallToolResult>,
): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (error) {
      return errorResult(error);
    }
  };
}

type IssueLike = { id?: number; notes?: Array<{ id?: number } & Record<string, unknown>> } & Record<
  string,
  unknown
>;

/** Adds view_url to an issue and each of its notes so humans can jump to the UI. */
export function enrichIssue(
  client: MantisRestClient,
  issue: IssueLike,
  fallbackId?: number,
): IssueLike {
  const id = issue.id ?? fallbackId;
  if (id === undefined) return issue;
  const enriched: IssueLike = { ...issue, view_url: client.buildIssueViewUrl(id) };
  if (Array.isArray(issue.notes)) {
    enriched.notes = issue.notes.map((note) =>
      note.id === undefined ? note : { ...note, view_url: client.buildNoteViewUrl(id, note.id) },
    );
  }
  return enriched;
}

/** Extracts the single issue object from a `{ issues: [...] }` REST response. */
export function unwrapIssue(result: unknown, fallbackId?: number): IssueLike {
  const record = (result ?? {}) as { issues?: IssueLike[]; issue?: IssueLike };
  const issue = record.issues?.[0] ?? record.issue ?? (result as IssueLike);
  if (issue.id === undefined && fallbackId !== undefined) issue.id = fallbackId;
  return issue;
}

/** Worker-pool: run `fn` over items with at most `concurrency` in flight at once. */
export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
