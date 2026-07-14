import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { RELATIONSHIP_NAME_TO_ID } from '../constants.js';
import { MantisApiError, type MantisRestClient } from '../mantis.js';
import { handler, jsonResult } from './shared.js';

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true } as const;

function resolveRelationshipTypeId(value: string | number): number {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  const asString = String(value).trim();
  if (/^\d+$/.test(asString)) return Number(asString);
  const id = RELATIONSHIP_NAME_TO_ID[asString.toLowerCase().replace(/\s+/g, '_')];
  if (id === undefined) {
    const valid = [...new Set(Object.keys(RELATIONSHIP_NAME_TO_ID))].join(', ');
    throw new MantisApiError(400, `Invalid relationship type "${asString}". Valid: ${valid}.`);
  }
  return id;
}

export function registerRelationshipTools(server: McpServer, client: MantisRestClient): void {
  server.registerTool(
    'mantis_add_relationship',
    {
      title: 'Add issue relationship',
      description:
        'Links two issues. type is one of: related_to, duplicate_of, has_duplicate, depends_on (parent_of), blocks (child_of) — or a numeric type id.',
      inputSchema: {
        issue_id: z.number().int().positive().describe('Source issue id.'),
        target_id: z.number().int().positive().describe('Target (other) issue id.'),
        type: z
          .union([z.string(), z.number().int().nonnegative()])
          .describe('Relationship type name or numeric id.'),
      },
      annotations: WRITE,
    },
    handler(async ({ issue_id, target_id, type }) => {
      const typeId = resolveRelationshipTypeId(type);
      const body = { issue: { id: target_id }, type: { id: typeId } };
      return jsonResult(await client.post(`/issues/${issue_id}/relationships`, body));
    }),
  );

  server.registerTool(
    'mantis_remove_relationship',
    {
      title: 'Remove issue relationship',
      description: 'Removes a relationship from an issue by relationship id.',
      inputSchema: {
        issue_id: z.number().int().positive().describe('Issue id owning the relationship.'),
        relationship_id: z.number().int().positive().describe('Relationship id to delete.'),
      },
      annotations: DESTRUCTIVE,
    },
    handler(async ({ issue_id, relationship_id }) => {
      await client.delete(`/issues/${issue_id}/relationships/${relationship_id}`);
      return jsonResult({ deleted: true, issue_id, relationship_id });
    }),
  );
}
