import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';

// Load .env from the package root (dist/.. or src/..), so the server finds its
// configuration regardless of the working directory Claude Code launches it in.
// Variables already present in the environment (e.g. passed via `claude mcp add -e`)
// take precedence — dotenv does not override them.
loadEnv({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

function readPort(value: string | undefined): number {
  // A blank/whitespace-only value means "use the default", consistent with the
  // other readers below (an empty string is not nullish, so `?? 3000` would not apply).
  if (value === undefined || value.trim() === '') return 3000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return parsed;
}

function readBaseUrl(value: string | undefined): string {
  const raw = (value ?? '').trim();
  if (raw.length === 0) {
    throw new Error(
      'MANTIS_REST_BASE_URL is required, e.g. https://mantis.example.com/api/rest/index.php',
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`MANTIS_REST_BASE_URL is not a valid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('MANTIS_REST_BASE_URL must use http or https.');
  }
  // Normalise: drop any trailing slash so `${base}/issues` never double-slashes.
  return raw.replace(/\/+$/, '');
}

function readBool(value: string | undefined, fallback: boolean): boolean {
  // A blank/whitespace-only value (e.g. `MANTIS_READONLY=` in .env) means
  // "keep the default", not false — otherwise a blank line would silently
  // flip the mode. Treat it the same as an unset variable.
  const normalised = (value ?? '').trim().toLowerCase();
  if (normalised === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalised)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalised)) return false;
  throw new Error(`Expected a boolean-like value but received "${value}".`);
}

function readPositiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

const defaultCacheDir = join(homedir(), '.cache', 'mcp-mantis');

export const config = {
  host: process.env.HOST ?? '127.0.0.1',
  port: readPort(process.env.PORT),
  mantis: {
    /** Full REST base up to and including `index.php` (needed when URL rewriting is disabled). */
    baseUrl: readBaseUrl(process.env.MANTIS_REST_BASE_URL),
    /** MantisBT API token (My Account -> API Tokens). Sent as the `Authorization` header. */
    token: (process.env.MANTIS_TOKEN ?? '').trim(),
    /**
     * When true, write tools are not registered and the client refuses mutations.
     * Defaults to false: this server is built for issue *resolvers* (status changes,
     * notes, assignment), so write access is the primary use case.
     */
    readonly: readBool(process.env.MANTIS_READONLY, false),
    /** Per-request timeout in milliseconds. */
    timeoutMs: readPositiveInt(process.env.MANTIS_TIMEOUT_MS, 30_000, 'MANTIS_TIMEOUT_MS'),
    /** Default page size for issue listings when the caller does not specify one. */
    defaultPageSize: readPositiveInt(
      process.env.MANTIS_DEFAULT_PAGE_SIZE,
      50,
      'MANTIS_DEFAULT_PAGE_SIZE',
    ),
    /** Upper bound the list tool will accept for `page_size`. */
    maxPageSize: readPositiveInt(process.env.MANTIS_MAX_PAGE_SIZE, 200, 'MANTIS_MAX_PAGE_SIZE'),
    /** How long (ms) to cache metadata such as enums and the resolved-status threshold. */
    metadataTtlMs: readPositiveInt(
      process.env.MANTIS_METADATA_TTL_MS,
      300_000,
      'MANTIS_METADATA_TTL_MS',
    ),
  },
  search: {
    /** Local semantic search over issues (Transformers.js). Disable with MANTIS_SEARCH_ENABLED=false. */
    enabled: readBool(process.env.MANTIS_SEARCH_ENABLED, true),
    /** Directory for the on-disk vector index. */
    dir: process.env.MANTIS_SEARCH_DIR ?? join(defaultCacheDir, 'search'),
    /** Embedding model (multilingual by default — issues are in Spanish). */
    modelName: process.env.MANTIS_SEARCH_MODEL ?? 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    /** ONNX intra-op threads. */
    numThreads: readPositiveInt(process.env.MANTIS_SEARCH_THREADS, 1, 'MANTIS_SEARCH_THREADS'),
  },
} as const;

export type AppConfig = typeof config;
export type MantisConfig = AppConfig['mantis'];
export type SearchConfig = AppConfig['search'];
