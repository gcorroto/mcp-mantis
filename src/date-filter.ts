import { z } from 'zod';

/** Reusable Zod fragment — spread into any tool's inputSchema. */
export const dateFilterSchema = {
  updated_after: z
    .string()
    .optional()
    .describe(
      'ISO-8601 timestamp — only issues updated strictly after this. Example: "2026-03-25T00:00:00Z"',
    ),
  updated_before: z
    .string()
    .optional()
    .describe('ISO-8601 timestamp — only issues updated strictly before this.'),
  created_after: z
    .string()
    .optional()
    .describe('ISO-8601 timestamp — only issues created strictly after this.'),
  created_before: z
    .string()
    .optional()
    .describe('ISO-8601 timestamp — only issues created strictly before this.'),
};

export interface DateFilter {
  updated_after?: string;
  updated_before?: string;
  created_after?: string;
  created_before?: string;
}

/**
 * True if the item's dates satisfy every active constraint (all exclusive).
 * If a constraint is set but the item lacks that date field, returns false.
 */
export function matchesDateFilter(
  item: { updated_at?: string; created_at?: string },
  filter: DateFilter,
): boolean {
  const { updated_after, updated_before, created_after, created_before } = filter;

  if (updated_after !== undefined) {
    if (!item.updated_at) return false;
    if (new Date(item.updated_at) <= new Date(updated_after)) return false;
  }
  if (updated_before !== undefined) {
    if (!item.updated_at) return false;
    if (new Date(item.updated_at) >= new Date(updated_before)) return false;
  }
  if (created_after !== undefined) {
    if (!item.created_at) return false;
    if (new Date(item.created_at) <= new Date(created_after)) return false;
  }
  if (created_before !== undefined) {
    if (!item.created_at) return false;
    if (new Date(item.created_at) >= new Date(created_before)) return false;
  }
  return true;
}

export function hasDateFilter(filter: DateFilter): boolean {
  return (
    filter.updated_after !== undefined ||
    filter.updated_before !== undefined ||
    filter.created_after !== undefined ||
    filter.created_before !== undefined
  );
}
