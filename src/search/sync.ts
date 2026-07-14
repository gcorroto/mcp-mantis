import type { MantisRestClient } from '../mantis.js';
import type { Embedder } from './embedder.js';
import type { VectorStore, VectorStoreItem } from './store.js';

interface IssueListItem {
  id: number;
  summary?: string;
  description?: string;
  updated_at?: string;
  created_at?: string;
}

interface IssueListResponse {
  issues?: IssueListItem[];
  total_count?: number;
}

const PAGE_SIZE = 50;
const EMBED_BATCH_SIZE = 10;
const CHECKPOINT_INTERVAL = 100;

/** Indexes Mantis issues into the vector store (summary + description embeddings). */
export class SearchSyncService {
  public constructor(
    private readonly client: MantisRestClient,
    private readonly store: VectorStore,
    private readonly embedder: Embedder,
  ) {}

  public async sync(
    projectId?: number,
  ): Promise<{ indexed: number; skipped: number; total: number | null }> {
    // Stamp the sync start BEFORE fetching, so issues edited during the run are
    // re-indexed by the next incremental sync instead of being skipped.
    const startedAt = new Date().toISOString();
    const lastSyncedAt = await this.store.getLastSyncedAt();
    const lastMs = lastSyncedAt ? Date.parse(lastSyncedAt) : null;

    const { issues, totalFromApi } = await this.fetchAllIssues(projectId);

    // The REST API has no server-side date filter, so incremental syncs skip
    // unchanged issues client-side — only re-embedding what changed.
    let skipped = 0;
    const toEmbed: Array<{ issue: IssueListItem; text: string }> = [];
    for (const issue of issues) {
      if (!issue.summary) {
        skipped++;
        continue;
      }
      if (lastMs !== null && issue.updated_at && Date.parse(issue.updated_at) <= lastMs) {
        skipped++; // unchanged since the last sync
        continue;
      }
      toEmbed.push({ issue, text: `${issue.summary}\n${issue.description ?? ''}`.trim() });
    }

    let indexed = 0;
    let sinceCheckpoint = 0;
    for (let i = 0; i < toEmbed.length; i += EMBED_BATCH_SIZE) {
      const batch = toEmbed.slice(i, i + EMBED_BATCH_SIZE);
      const vectors = await this.embedder.embedBatch(batch.map((e) => e.text));
      const items: VectorStoreItem[] = batch.map((e, j) => ({
        id: e.issue.id,
        vector: vectors[j]!,
        metadata: {
          summary: e.issue.summary!,
          description: e.issue.description,
          updated_at: e.issue.updated_at,
          created_at: e.issue.created_at,
        },
      }));
      await this.store.addBatch(items);
      indexed += items.length;
      sinceCheckpoint += items.length;
      if (sinceCheckpoint >= CHECKPOINT_INTERVAL) {
        await this.store.flush();
        sinceCheckpoint = 0;
      }
    }

    await this.store.flush();
    await this.store.setLastSyncedAt(startedAt);

    const storeCount = await this.store.count();
    const total = totalFromApi ?? (lastSyncedAt === null ? indexed + skipped : storeCount);
    await this.store.setLastKnownTotal(total);

    return { indexed, skipped, total };
  }

  private async fetchAllIssues(
    projectId: number | undefined,
  ): Promise<{ issues: IssueListItem[]; totalFromApi: number | null }> {
    const all: IssueListItem[] = [];
    let totalFromApi: number | null = null;
    let page = 1;

    for (;;) {
      const params: Record<string, string | number | undefined> = {
        page_size: PAGE_SIZE,
        page,
        select: 'id,summary,description,updated_at,created_at',
        project_id: projectId,
      };
      const response = await this.client.get<IssueListResponse>('/issues', params);
      const pageIssues = response.issues ?? [];
      all.push(...pageIssues);
      if (totalFromApi === null && response.total_count != null)
        totalFromApi = response.total_count;

      // Hard stop on an empty/short page regardless of any (possibly over-reported)
      // total_count, so the loop can never spin forever hammering the API.
      if (pageIssues.length < PAGE_SIZE) break;
      if (totalFromApi !== null && all.length >= totalFromApi) break;
      page++;
    }
    return { issues: all, totalFromApi };
  }
}
