import type { MantisConfig } from './config.js';
import {
  CANONICAL_ENUM_NAMES,
  DEFAULT_RESOLVED_STATUS_THRESHOLD,
  ENUM_CONFIG_OPTIONS,
  ENUM_GROUPS,
  type EnumGroup,
} from './constants.js';

/** Error carrying the HTTP status and MantisBT's structured error payload. */
export class MantisApiError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
    public readonly code?: number,
    public readonly localized?: string,
  ) {
    super(message);
    this.name = 'MantisApiError';
  }
}

export interface MantisStatus {
  baseUrl: string;
  webBaseUrl: string;
  tokenConfigured: boolean;
  readonly: boolean;
}

export interface EnumEntry {
  id: number;
  name: string;
  label?: string;
}

export type EnumsMap = Record<EnumGroup, EnumEntry[]>;

export interface AttachmentDownload {
  id: number;
  filename: string;
  size: number;
  contentType: string;
  mediaType: string;
  base64: string;
}

export interface MantisUser {
  id: number;
  name: string;
  real_name?: string;
  access_level?: unknown;
}

type JsonRecord = Record<string, unknown>;
type QueryValue = string | number | boolean | undefined;

interface Cached<T> {
  at: number;
  value: T;
}

/**
 * Typed wrapper over the MantisBT REST API (v2.27.x). Auth is an API token in the
 * `Authorization` header. The base URL includes `index.php` (URL rewriting is off
 * on the QA host). SOAP is intentionally unused (disabled server-side).
 */
export class MantisRestClient {
  private enumsCache?: Cached<EnumsMap>;
  private thresholdCache?: Cached<number>;
  private readonly webBase: string;

  public constructor(private readonly cfg: MantisConfig) {
    this.webBase = deriveWebBaseUrl(cfg.baseUrl);
  }

  public getStatus(): MantisStatus {
    return {
      baseUrl: this.cfg.baseUrl,
      webBaseUrl: this.webBase,
      tokenConfigured: this.cfg.token.length > 0,
      readonly: this.cfg.readonly,
    };
  }

  public get isReadonly(): boolean {
    return this.cfg.readonly;
  }

  public get webBaseUrl(): string {
    return this.webBase;
  }

  public get defaultPageSize(): number {
    return this.cfg.defaultPageSize;
  }

  public get maxPageSize(): number {
    return this.cfg.maxPageSize;
  }

  /** Clamps a requested page size to [1, maxPageSize], defaulting when omitted. */
  public clampPageSize(requested?: number): number {
    return Math.min(requested ?? this.cfg.defaultPageSize, this.cfg.maxPageSize);
  }

  public buildIssueViewUrl(issueId: number): string {
    return `${this.webBase}/view.php?id=${issueId}`;
  }

  public buildNoteViewUrl(issueId: number, noteId: number): string {
    return `${this.webBase}/view.php?id=${issueId}#bugnote${noteId}`;
  }

  // --- Transport verbs -----------------------------------------------------

  public get<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return this.request<T>('GET', path, toParams(query));
  }

  public post<T>(path: string, body: unknown): Promise<T> {
    this.assertWritable();
    return this.request<T>('POST', path, undefined, body);
  }

  public patch<T>(path: string, body: unknown): Promise<T> {
    this.assertWritable();
    return this.request<T>('PATCH', path, undefined, body);
  }

  public delete<T>(path: string): Promise<T> {
    this.assertWritable();
    return this.request<T>('DELETE', path);
  }

  // --- Metadata (cached) ---------------------------------------------------

  public getConfig(options: readonly string[]): Promise<JsonRecord> {
    const params = new URLSearchParams();
    for (const option of options) params.append('option[]', option);
    return this.request<JsonRecord>('GET', '/config', params);
  }

  /** Live enums keyed by group, each as [{id,name,label}]. Cached for metadataTtlMs. */
  public async getEnums(force = false): Promise<EnumsMap> {
    if (!force && this.enumsCache && Date.now() - this.enumsCache.at < this.cfg.metadataTtlMs) {
      return this.enumsCache.value;
    }
    const raw = await this.getConfig(ENUM_CONFIG_OPTIONS);
    const configs = Array.isArray(raw.configs) ? (raw.configs as JsonRecord[]) : [];
    const map: EnumsMap = {
      status: [],
      priority: [],
      severity: [],
      resolution: [],
      reproducibility: [],
    };
    for (const entry of configs) {
      const option = String(entry.option ?? '');
      const group = ENUM_GROUPS.find((g) => option === `${g}_enum_string`);
      if (group && Array.isArray(entry.value)) {
        map[group] = (entry.value as JsonRecord[]).map((v) => ({
          id: Number(v.id),
          name: String(v.name ?? ''),
          label: v.label === undefined ? undefined : String(v.label),
        }));
      }
    }
    this.enumsCache = { at: Date.now(), value: map };
    return map;
  }

  /** Instance-configured status id at/above which an issue counts as resolved. */
  public async getResolvedStatusThreshold(): Promise<number> {
    if (this.thresholdCache && Date.now() - this.thresholdCache.at < this.cfg.metadataTtlMs) {
      return this.thresholdCache.value;
    }
    let threshold = DEFAULT_RESOLVED_STATUS_THRESHOLD;
    try {
      const raw = await this.getConfig(['bug_resolved_status_threshold']);
      const configs = Array.isArray(raw.configs) ? (raw.configs as JsonRecord[]) : [];
      const value = configs[0]?.value;
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0) threshold = parsed;
    } catch {
      // fall back to the default threshold
    }
    this.thresholdCache = { at: Date.now(), value: threshold };
    return threshold;
  }

  /**
   * Resolves an enum value (numeric id, localized name, or canonical label) to a
   * numeric id. Throws MantisApiError with the valid options when it cannot match.
   */
  public async resolveEnumId(group: EnumGroup, value: string | number): Promise<number> {
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    const asString = String(value).trim();
    if (/^\d+$/.test(asString)) return Number(asString);

    const lower = asString.toLowerCase();
    const enums = await this.getEnums();
    const entries = enums[group] ?? [];
    const match = entries.find(
      (e) => e.name.toLowerCase() === lower || (e.label ?? '').toLowerCase() === lower,
    );
    if (match) return match.id;

    // Fallback: canonical English name, but only if that id actually exists here.
    const canonical = CANONICAL_ENUM_NAMES[group];
    const canonicalId = Object.entries(canonical).find(([, n]) => n.toLowerCase() === lower)?.[0];
    if (canonicalId !== undefined && entries.some((e) => e.id === Number(canonicalId))) {
      return Number(canonicalId);
    }

    const valid = entries
      .map((e) => (e.label && e.label !== e.name ? `${e.name}/${e.label}` : e.name))
      .join(', ');
    throw new MantisApiError(
      400,
      `Invalid ${group} "${asString}". Valid values: ${valid || '(none — call mantis_get_enums)'}.`,
    );
  }

  // --- Domain reads --------------------------------------------------------

  public getMe(): Promise<JsonRecord> {
    return this.get<JsonRecord>('/users/me');
  }

  public getProjects(): Promise<JsonRecord> {
    return this.get<JsonRecord>('/projects');
  }

  public getProject(projectId: number): Promise<JsonRecord> {
    return this.get<JsonRecord>(`/projects/${encodeId(projectId)}`);
  }

  public listFilters(projectId?: number): Promise<JsonRecord> {
    return this.get<JsonRecord>(
      '/filters',
      projectId === undefined ? undefined : { project_id: projectId },
    );
  }

  public async getProjectUsers(projectId: number): Promise<MantisUser[]> {
    const raw = await this.get<JsonRecord>(`/projects/${encodeId(projectId)}/users`, {
      page_size: 200,
    });
    return Array.isArray(raw.users) ? (raw.users as MantisUser[]) : [];
  }

  /** Resolves a handler login name (or numeric id) to a user id within a project. */
  public async resolveHandlerId(projectId: number, nameOrId: string | number): Promise<number> {
    if (typeof nameOrId === 'number' && Number.isInteger(nameOrId)) return nameOrId;
    const asString = String(nameOrId).trim();
    if (/^\d+$/.test(asString)) return Number(asString);
    const users = await this.getProjectUsers(projectId);
    const lower = asString.toLowerCase();
    const user = users.find(
      (u) => u.name.toLowerCase() === lower || (u.real_name ?? '').toLowerCase() === lower,
    );
    if (!user) {
      const names = users.map((u) => u.name).join(', ');
      throw new MantisApiError(
        404,
        `User "${asString}" not found in project ${projectId}. Available: ${names || 'none'}.`,
      );
    }
    return user.id;
  }

  /** Downloads an issue attachment; content arrives base64-encoded in the JSON body. */
  public async getAttachment(issueId: number, fileId: number): Promise<AttachmentDownload> {
    const body = await this.get<JsonRecord>(
      `/issues/${encodeId(issueId)}/files/${encodeId(fileId)}`,
    );
    const files = Array.isArray(body.files) ? (body.files as JsonRecord[]) : [];
    const file = files[0];
    if (file === undefined) {
      throw new MantisApiError(404, `Attachment ${fileId} not found on issue ${issueId}.`);
    }
    const contentType = String(file.content_type ?? 'application/octet-stream');
    const base64 = typeof file.content === 'string' ? file.content : '';
    if (base64.length === 0) {
      throw new MantisApiError(502, `Attachment ${fileId} returned no content.`);
    }
    return {
      id: Number(file.id ?? fileId),
      filename: String(file.filename ?? `attachment-${fileId}`),
      size: Number(file.size ?? 0),
      contentType,
      mediaType: stripContentTypeParams(contentType),
      base64,
    };
  }

  // --- Internals -----------------------------------------------------------

  private assertWritable(): void {
    if (this.cfg.readonly) {
      throw new MantisApiError(
        403,
        'Server is in read-only mode (MANTIS_READONLY=true); write operations are disabled.',
      );
    }
  }

  private async request<T>(
    method: string,
    path: string,
    query?: URLSearchParams,
    body?: unknown,
  ): Promise<T> {
    if (this.cfg.token.length === 0) {
      throw new MantisApiError(401, 'MANTIS_TOKEN is not configured; cannot call the Mantis API.');
    }
    const qs = query && [...query.keys()].length > 0 ? `?${query.toString()}` : '';
    const url = `${this.cfg.baseUrl}${path}${qs}`;

    const headers: Record<string, string> = {
      Authorization: this.cfg.token,
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const detail =
        error instanceof Error && error.name === 'TimeoutError'
          ? `timed out after ${this.cfg.timeoutMs}ms`
          : reason;
      throw new MantisApiError(0, `Network error calling ${method} ${path}: ${detail}`);
    }

    const text = await response.text();
    if (!response.ok) {
      throw toApiError(response.status, text);
    }
    if (text.length === 0) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new MantisApiError(
        502,
        `Expected JSON from ${method} ${path} but received: ${text.slice(0, 200)}`,
      );
    }
  }
}

function toParams(query?: Record<string, QueryValue>): URLSearchParams | undefined {
  if (!query) return undefined;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return params;
}

function deriveWebBaseUrl(baseUrl: string): string {
  // http://host/mantis/api/rest/index.php -> http://host/mantis
  return baseUrl.replace(/\/api\/rest(\/index\.php)?\/?$/i, '');
}

function encodeId(id: number): string {
  if (!Number.isInteger(id) || id < 0) {
    throw new MantisApiError(400, `Invalid id: ${id}`);
  }
  return String(id);
}

function stripContentTypeParams(contentType: string): string {
  const semicolon = contentType.indexOf(';');
  return (semicolon === -1 ? contentType : contentType.slice(0, semicolon)).trim();
}

function toApiError(status: number, rawBody: string): MantisApiError {
  try {
    const parsed = JSON.parse(rawBody) as { message?: string; code?: number; localized?: string };
    const message = parsed.message ?? parsed.localized ?? `HTTP ${status}`;
    return new MantisApiError(status, message, parsed.code, parsed.localized);
  } catch {
    const snippet = rawBody.trim().slice(0, 200);
    return new MantisApiError(status, snippet.length > 0 ? snippet : `HTTP ${status}`);
  }
}
