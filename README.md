# mcp-mantis

[![Node.js](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![MCP](https://img.shields.io/badge/MCP-stdio-5A45FF)](https://modelcontextprotocol.io/)

An MCP stdio server that gives an AI assistant direct access to a MantisBT tracker,
oriented to **issue resolvers**: read issues (with images), change status, resolve,
assign, comment and link — plus **local semantic search** over issues.

> **REST, not SOAP.** This server uses the MantisBT **REST API** (Mantis 2.27+), the supported and
> non-deprecated integration path. The legacy SOAP API is not used and does not need to be enabled.

## Setup

Requires Node.js 22+ (uses the built-in global `fetch`).

```bash
npm install
cp .env.example .env
```

Then edit `.env`:

| Variable                                                                                          | Required | Notes                                                                                                                       |
| ------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| `MANTIS_REST_BASE_URL`                                                                            | yes      | Must include `index.php` when URL rewriting is disabled on the host.                                                        |
| `MANTIS_TOKEN`                                                                                    | yes      | API token from Mantis: **My Account → API Tokens → Create**. No username/password; the token is the `Authorization` header. |
| `MANTIS_READONLY`                                                                                 | no       | `false` (default) enables write tools. Set `true` for read-only. A blank value keeps the default.                           |
| `MANTIS_SEARCH_ENABLED`                                                                           | no       | `true` (default) registers semantic search tools. Needs the optional `@huggingface/transformers`.                           |
| `MANTIS_SEARCH_MODEL` / `MANTIS_SEARCH_DIR` / `MANTIS_SEARCH_THREADS`                             | no       | Embedding model, index directory, ONNX threads.                                                                             |
| `MANTIS_TIMEOUT_MS`, `MANTIS_METADATA_TTL_MS`, `MANTIS_DEFAULT_PAGE_SIZE`, `MANTIS_MAX_PAGE_SIZE` | no       | Tuning.                                                                                                                     |

## Register with Claude Code

From npm (published package), no local checkout needed — the token is supplied here, never stored in the repo:

```bash
claude mcp add mantis \
  -e MANTIS_REST_BASE_URL=https://mantis.example.com/api/rest/index.php \
  -e MANTIS_TOKEN=your-token-here \
  -- npx -y @grec0/mcp-mantis
```

Or from a local build:

```bash
npm run build
claude mcp add mantis -- node /path/to/mcp-mantis/dist/mcp.js
```

Equivalent `.mcp.json` (the `env` block is where `MANTIS_TOKEN` belongs):

```json
{
  "mcpServers": {
    "mantis": {
      "command": "npx",
      "args": ["-y", "@grec0/mcp-mantis"],
      "env": {
        "MANTIS_REST_BASE_URL": "https://mantis.example.com/api/rest/index.php",
        "MANTIS_TOKEN": "your-token-here",
        "MANTIS_READONLY": "false"
      }
    }
  }
}
```

## Tools

**Read**

| Tool                                          | Purpose                                                                                                                                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mantis_whoami`                               | Authenticated user + accessible projects.                                                                                                                                              |
| `mantis_list_projects` / `mantis_get_project` | Projects with versions, categories, custom fields.                                                                                                                                     |
| `mantis_list_project_users`                   | Project members (valid handler names for assignment).                                                                                                                                  |
| `mantis_list_issues`                          | Paginated issues, lightweight summary by default (use `mantis_get_issue` for full detail). Client-side filters: `status` (name or `"open"`), `assigned_to`, `reporter_id`, date range. |
| `mantis_get_issue` / `mantis_get_issues`      | One issue (complete) / batch fetch by ids.                                                                                                                                             |
| `mantis_get_issue_attachment`                 | Download an attachment; images come back viewable.                                                                                                                                     |
| `mantis_get_enums` / `mantis_get_config`      | Enumerations ({id,name,label}) / raw config options.                                                                                                                                   |
| `mantis_list_filters`                         | Stored filters (feed a `filter_id` into `mantis_list_issues`).                                                                                                                         |

**Resolve / write** (registered when `MANTIS_READONLY=false`)

| Tool                                                     | Purpose                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `mantis_update_issue`                                    | Partial update: status, resolution, handler, priority, fields… Accepts localized/canonical enum names. Optional `note` and `dry_run`. |
| `mantis_resolve_issue`                                   | Sets **both** status and resolution (defaults `resuelta` / `fixed`) + optional note.                                                  |
| `mantis_assign_issue`                                    | Assign to a handler by login name (or id), optional status change + note.                                                             |
| `mantis_add_note`                                        | Add a public/private note.                                                                                                            |
| `mantis_add_relationship` / `mantis_remove_relationship` | Link issues (related, duplicate, blocks, depends…).                                                                                   |

**Semantic search** (registered when `MANTIS_SEARCH_ENABLED=true`)

| Tool                          | Purpose                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `mantis_rebuild_search_index` | Build/update the local vector index from issues (first run downloads the model).      |
| `mantis_search_issues`        | Natural-language search (multilingual). Optional `select`, `highlight`, date filters. |
| `mantis_search_index_status`  | Index fill level and last sync.                                                       |

Enum names accept the instance's localized names _and_ the canonical English labels (e.g. `asignada`
or `confirmed`). `mantis_list_issues` `status="open"` uses the live `bug_resolved_status_threshold`.
Ad-hoc free-text search is not a server-side REST filter — use `mantis_search_issues` or a stored `filter_id`.

## Commands

| Command                                 | Purpose                                                      |
| --------------------------------------- | ------------------------------------------------------------ |
| `npm run dev:mcp` / `npm run start:mcp` | Run the MCP stdio server (reload / built).                   |
| `npm run build`                         | Compile TypeScript into `dist/`.                             |
| `npm run check`                         | Type-check, lint and format-check.                           |
| `npm run dev`                           | Express health server (`GET /health`, `GET /health/mantis`). |

## Project structure

```
src/
├── config.ts        # Validated environment configuration
├── constants.ts     # Enum aliases, relationship types
├── date-filter.ts   # Shared date-range filtering
├── mantis.ts        # MantisBT REST client (fetch, enum/handler resolution, caching)
├── tools/           # meta, issues, notes, relationships, shared helpers
├── search/          # embedder (Transformers.js), vector store, sync, search tools
├── server.ts        # Tool registration
├── mcp.ts           # MCP stdio executable
└── index.ts         # Express health endpoints
```

## Security

`.env` is git-ignored (only `.env.example` is committed) — never commit the token. Write access is
scoped to the token owner's Mantis permissions; set `MANTIS_READONLY=true` to disable all mutations.
Health endpoints expose no credentials or user data. Run `npm run check` before committing.
