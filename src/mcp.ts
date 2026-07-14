#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { config } from './config.js';
import { MantisRestClient } from './mantis.js';
import { createMcpServer } from './server.js';

// stdio transport owns stdout for the MCP protocol; only ever log to stderr.
const client = new MantisRestClient(config.mantis);
const server = createMcpServer(client, config.search);
const transport = new StdioServerTransport();

await server.connect(transport);

const status = client.getStatus();
console.error(
  `[mantis-mcp] connected | baseUrl=${status.baseUrl} | token=${
    status.tokenConfigured ? 'set' : 'MISSING'
  } | mode=${status.readonly ? 'read-only' : 'read-write'} | search=${config.search.enabled ? 'on' : 'off'}`,
);
