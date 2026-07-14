import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { SearchConfig } from './config.js';
import type { MantisRestClient } from './mantis.js';
import { Embedder } from './search/embedder.js';
import { VectorStore } from './search/store.js';
import { registerSearchTools } from './search/tools.js';
import { registerIssueTools } from './tools/issues.js';
import { registerMetaTools } from './tools/meta.js';
import { registerNoteTools } from './tools/notes.js';
import { registerRelationshipTools } from './tools/relationships.js';

/**
 * Builds the MCP surface over the Mantis REST client. Read tools are always
 * registered; write tools (notes, issue updates, relationships) only when the
 * client is not read-only. Semantic search tools are registered when enabled.
 */
export function createMcpServer(client: MantisRestClient, search: SearchConfig): McpServer {
  const server = new McpServer({
    name: 'mcp-stdio-mantis-soap',
    version: '0.3.0',
  });

  registerMetaTools(server, client);
  registerIssueTools(server, client); // read tools always; write tools guarded internally

  if (!client.isReadonly) {
    registerNoteTools(server, client);
    registerRelationshipTools(server, client);
  }

  if (search.enabled) {
    const store = new VectorStore(search.dir);
    const embedder = new Embedder(search.modelName, search.numThreads);
    registerSearchTools(server, client, store, embedder);
  }

  return server;
}
