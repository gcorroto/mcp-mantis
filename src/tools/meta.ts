import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { ENUM_CONFIG_OPTIONS } from '../constants.js';
import type { MantisRestClient } from '../mantis.js';
import { handler, jsonResult } from './shared.js';

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;

export function registerMetaTools(server: McpServer, client: MantisRestClient): void {
  server.registerTool(
    'mantis_whoami',
    {
      title: 'Whoami',
      description:
        'Returns the authenticated Mantis user (id, name, access level, accessible projects). Use it to verify the API token works.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    handler(async () => jsonResult(await client.getMe())),
  );

  server.registerTool(
    'mantis_list_projects',
    {
      title: 'List projects',
      description:
        'Lists all projects accessible to the token owner, including nested versions, categories and custom field definitions.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    handler(async () => jsonResult(await client.getProjects())),
  );

  server.registerTool(
    'mantis_get_project',
    {
      title: 'Get project',
      description:
        'Returns a single project by id with its versions, categories and custom fields.',
      inputSchema: { project_id: z.number().int().positive() },
      annotations: READ_ONLY,
    },
    handler(async ({ project_id }) => jsonResult(await client.getProject(project_id))),
  );

  server.registerTool(
    'mantis_list_project_users',
    {
      title: 'List project members',
      description:
        'Lists the members of a project (id, login name, access level). Use it to find valid handler names for assignment.',
      inputSchema: { project_id: z.number().int().positive() },
      annotations: READ_ONLY,
    },
    handler(async ({ project_id }) => jsonResult(await client.getProjectUsers(project_id))),
  );

  server.registerTool(
    'mantis_get_enums',
    {
      title: 'Get enumerations',
      description:
        'Returns the common Mantis enumerations (status, priority, severity, resolution, reproducibility, etc.) as {id,name,label} lists. ' +
        'This instance is localized (Spanish names) — use it to map issue status/priority codes and to learn valid names for status changes.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    handler(async () => jsonResult(await client.getConfig([...ENUM_CONFIG_OPTIONS]))),
  );

  server.registerTool(
    'mantis_get_config',
    {
      title: 'Get config options',
      description:
        'Reads arbitrary Mantis configuration options exposed to the REST API, e.g. ["status_enum_string","bug_resolved_status_threshold"].',
      inputSchema: {
        options: z.array(z.string().min(1)).min(1).describe('Config option names to read.'),
      },
      annotations: READ_ONLY,
    },
    handler(async ({ options }) => jsonResult(await client.getConfig(options))),
  );

  server.registerTool(
    'mantis_list_filters',
    {
      title: 'List stored filters',
      description:
        'Lists stored filters, optionally scoped to a project. Pass a filter id to mantis_list_issues to run it.',
      inputSchema: { project_id: z.number().int().positive().optional() },
      annotations: READ_ONLY,
    },
    handler(async ({ project_id }) => jsonResult(await client.listFilters(project_id))),
  );
}
