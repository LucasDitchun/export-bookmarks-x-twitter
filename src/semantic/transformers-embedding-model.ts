import type {
  EmbeddingModel,
  SemanticBackend,
  SemanticProgress,
} from "./semantic-worker-runtime";
import wasmFactoryUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import wasmBinaryUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

export const MODEL_ID = "Xenova/multilingual-e5-small";
export const MODEL_REVISION = "761b726dd34fb83930e26aab4e9ac3899aa1fa78";
export const MODEL_DTYPE = "q8" as const;
export const MODEL_ESTIMATED_DOWNLOAD_BYTES = 136 * 1024 * 1024;

interface PipelineTensor {
  tolist(): number[][];
}

export interface FeatureExtractionPipeline {
  (
    values: readonly string[],
    options: { pooling: "mean"; normalize: true },
  ): Promise<PipelineTensor>;
  dispose(): Promise<unknown>;
}

export interface PipelineLoadOptions {
  model: typeof MODEL_ID;
  revision: typeof MODEL_REVISION;
  dtype: typeof MODEL_DTYPE;
  device: SemanticBackend;
  allowDownload: boolean;
  onProgress?: (progress: SemanticProgress) => void;
}

export type PipelineLoader = (
  options: PipelineLoadOptions,
) => Promise<FeatureExtractionPipeline>;

interface TransformersProgress {
  status?: string;
  file?: string;
  loaded?: number;
  total?: number;
  progress?: number;
}

const loadTransformersPipeline: PipelineLoader = async (options) => {
  const transformers = await import("@huggingface/transformers");
  const onnx = transformers.env.backends.onnx;
  const wasm = onnx.wasm;
  if (wasm === undefined) throw new Error("The packaged WASM backend is unavailable.");
  transformers.env.allowRemoteModels = options.allowDownload;
  transformers.env.allowLocalModels = false;
  transformers.env.useBrowserCache = true;
  // MV3 does not allow the blob: module import used by the optional WASM cache
  // preloader. ORT can import our packaged extension URL directly instead.
  transformers.env.useWasmCache = false;
  transformers.env.cacheKey = "bookmark-x-transformers-v1";
  wasm.wasmPaths = {
    mjs: wasmFactoryUrl,
    wasm: wasmBinaryUrl,
  };
  wasm.numThreads = 1;

  const progress_callback = (event: TransformersProgress) => {
    if (event.status !== "progress" && event.status !== "progress_total") return;
    const total = Math.max(0, event.total ?? 0);
    const completed = Math.max(
      0,
      event.loaded ?? (total * Math.max(0, event.progress ?? 0)) / 100,
    );
    options.onProgress?.({
      phase: "downloading",
      completed,
      total,
      ...(event.file === undefined ? {} : { file: event.file }),
    });
  };

  return (await transformers.pipeline("feature-extraction", options.model, {
    revision: options.revision,
    dtype: options.dtype,
    device: options.device,
    local_files_only: !options.allowDownload,
    progress_callback,
  })) as unknown as FeatureExtractionPipeline;
};

export class TransformersEmbeddingModel implements EmbeddingModel {
  private active: FeatureExtractionPipeline | null = null;

  constructor(
    private readonly loader: PipelineLoader = loadTransformersPipeline,
    private readonly webGpuAvailable = typeof navigator !== "undefined" &&
      "gpu" in navigator,
  ) {}

  async load(
    allowDownload: boolean,
    onProgress?: (progress: SemanticProgress) => void,
  ): Promise<SemanticBackend> {
    if (this.active !== null) throw new Error("The semantic model is already loaded.");
    const common = {
      model: MODEL_ID,
      revision: MODEL_REVISION,
      dtype: MODEL_DTYPE,
      allowDownload,
      ...(onProgress === undefined ? {} : { onProgress }),
    } as const;
    if (this.webGpuAvailable) {
      try {
        this.active = await this.loader({ ...common, device: "webgpu" });
        return "webgpu";
      } catch {
        // WebGPU availability does not guarantee that this model/device can create a
        // session. The packaged WASM backend is the deterministic fallback.
      }
    }
    this.active = await this.loader({ ...common, device: "wasm" });
    return "wasm";
  }

  embedPassages(values: readonly string[]): Promise<Float32Array[]> {
    return this.embed(values);
  }

  async embedQuery(value: string): Promise<Float32Array> {
    const [vector] = await this.embed([value]);
    if (vector === undefined) throw new Error("The semantic model returned no query.");
    return vector;
  }

  async dispose(): Promise<void> {
    const current = this.active;
    this.active = null;
    await current?.dispose();
  }

  private async embed(values: readonly string[]): Promise<Float32Array[]> {
    if (this.active === null) throw new Error("The semantic model is not loaded.");
    const output = await this.active(values, { pooling: "mean", normalize: true });
    return output.tolist().map((vector) => new Float32Array(vector));
  }
}
