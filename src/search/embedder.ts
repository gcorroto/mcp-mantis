// Wraps @huggingface/transformers for local ONNX embeddings. Lazy-loaded on
// first use — no model download at server startup. The package is an OPTIONAL
// dependency; the import is guarded so the server still starts without it.

interface PipelineOutput {
  data: Float32Array | number[];
  dims: number[];
}

interface Pipeline {
  (
    text: string | string[],
    options?: Record<string, unknown>,
  ): Promise<PipelineOutput | PipelineOutput[]>;
}

interface PipelineOptions {
  session_options?: { intra_op_num_threads?: number; inter_op_num_threads?: number };
}

interface TransformersModule {
  pipeline: (task: string, model: string, options?: PipelineOptions) => Promise<Pipeline>;
}

export class Embedder {
  private pipe: Pipeline | null = null;

  public constructor(
    private readonly modelName: string,
    private readonly numThreads: number = 1,
  ) {}

  private async load(): Promise<Pipeline> {
    if (this.pipe) return this.pipe;
    process.stderr.write(`[mantis-search] Loading embedding model ${this.modelName}...\n`);

    let transformers: TransformersModule;
    try {
      transformers = (await import('@huggingface/transformers')) as unknown as TransformersModule;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Semantic search needs @huggingface/transformers, which failed to load: ${msg}. ` +
          `Run "npm install @huggingface/transformers" or set MANTIS_SEARCH_ENABLED=false.`,
      );
    }

    this.pipe = await transformers.pipeline('feature-extraction', this.modelName, {
      session_options: { intra_op_num_threads: this.numThreads, inter_op_num_threads: 1 },
    });
    return this.pipe;
  }

  public async embed(text: string): Promise<number[]> {
    const extractor = await this.load();
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return extractVector(output as PipelineOutput);
  }

  public async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await this.load();
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    if (Array.isArray(output)) return (output as PipelineOutput[]).map(extractVector);
    return extractBatchVectors(output as PipelineOutput, texts.length);
  }
}

function extractVector(output: PipelineOutput): number[] {
  return Array.from(output.data as Float32Array);
}

function extractBatchVectors(output: PipelineOutput, batchSize: number): number[][] {
  const data = Array.from(output.data as Float32Array);
  const vecSize = data.length / batchSize;
  if (!Number.isInteger(vecSize)) {
    throw new Error(
      `Unexpected batch output shape: ${data.length} elements for batch ${batchSize}`,
    );
  }
  const result: number[][] = [];
  for (let i = 0; i < batchSize; i++) result.push(data.slice(i * vecSize, (i + 1) * vecSize));
  return result;
}
