import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface VectorStoreItem {
  id: number;
  vector: number[];
  metadata: { summary: string; description?: string; updated_at?: string; created_at?: string };
}

/**
 * Simple file-backed vector store: an in-memory Map persisted to JSON, with
 * brute-force cosine search. Fine for the scale of a single Mantis instance.
 */
export class VectorStore {
  private readonly indexFile: string;
  private readonly lastSyncFile: string;
  private readonly lastTotalFile: string;
  private items = new Map<number, VectorStoreItem>();
  private loaded = false;

  public constructor(private readonly dir: string) {
    this.indexFile = join(dir, 'index.json');
    this.lastSyncFile = join(dir, 'last_sync.txt');
    this.lastTotalFile = join(dir, 'last_total.txt');
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await mkdir(this.dir, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.indexFile, 'utf-8')) as VectorStoreItem[];
      this.items = new Map(parsed.map((item) => [item.id, item]));
    } catch {
      this.items = new Map();
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    const tmp = this.indexFile + '.tmp';
    await writeFile(tmp, JSON.stringify([...this.items.values()]), 'utf-8');
    await rename(tmp, this.indexFile);
  }

  public async addBatch(items: VectorStoreItem[]): Promise<void> {
    await this.ensureLoaded();
    for (const item of items) this.items.set(item.id, item);
  }

  public async flush(): Promise<void> {
    await this.ensureLoaded();
    await this.persist();
  }

  public async search(
    vector: number[],
    topN: number,
  ): Promise<Array<{ id: number; score: number }>> {
    await this.ensureLoaded();
    const results = [...this.items.values()].map((item) => ({
      id: item.id,
      score: cosineSimilarity(vector, item.vector),
    }));
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topN);
  }

  public async getItem(id: number): Promise<VectorStoreItem | null> {
    await this.ensureLoaded();
    return this.items.get(id) ?? null;
  }

  public async count(): Promise<number> {
    await this.ensureLoaded();
    return this.items.size;
  }

  public async clear(): Promise<void> {
    await this.ensureLoaded();
    this.items.clear();
    await this.persist();
  }

  public async getLastSyncedAt(): Promise<string | null> {
    try {
      return (await readFile(this.lastSyncFile, 'utf-8')).trim() || null;
    } catch {
      return null;
    }
  }

  public async setLastSyncedAt(ts: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.lastSyncFile, ts, 'utf-8');
  }

  public async resetLastSyncedAt(): Promise<void> {
    try {
      await unlink(this.lastSyncFile);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  public async getLastKnownTotal(): Promise<number | null> {
    try {
      const parsed = parseInt((await readFile(this.lastTotalFile, 'utf-8')).trim(), 10);
      return Number.isNaN(parsed) ? null : parsed;
    } catch {
      return null;
    }
  }

  public async setLastKnownTotal(total: number): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.lastTotalFile, String(total), 'utf-8');
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
