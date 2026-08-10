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

export type WebGpuProbe = () => Promise<boolean>;

export class WebGpuPipelineLoadError extends Error {
  constructor(cause: unknown) {
    super("The WebGPU semantic pipeline failed to load.", { cause });
    this.name = "WebGpuPipelineLoadError";
  }
}

interface TransformersProgress {
  status?: string;
  file?: string;
  loaded?: number;
  total?: number;
  progress?: number;
}

interface PretrainedComponentLoader {
  from_pretrained(model: string, options: Record<string, unknown>): Promise<unknown>;
}

interface JsonCache {
  match(request: string): Promise<Response | undefined>;
}

function pinnedAssetUrl(file: string): string {
  return `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/${file}`;
}

export async function loadPinnedTokenizerFromCache(
  cache: JsonCache,
  create: (tokenizer: unknown, config: unknown) => unknown,
): Promise<unknown> {
  const [tokenizerResponse, configResponse] = await Promise.all([
    cache.match(pinnedAssetUrl("tokenizer.json")),
    cache.match(pinnedAssetUrl("tokenizer_config.json")),
  ]);
  if (tokenizerResponse === undefined || configResponse === undefined) {
    throw new Error("The pinned semantic tokenizer is missing from Browser Cache.");
  }
  return create(await tokenizerResponse.json(), await configResponse.json());
}

export async function loadPinnedComponents(
  loaders: {
    AutoTokenizer: PretrainedComponentLoader;
    AutoModel: PretrainedComponentLoader;
    XLMRobertaTokenizer: new (tokenizer: unknown, config: unknown) => unknown;
  },
  options: PipelineLoadOptions,
  progressCallback: (event: TransformersProgress) => void,
): Promise<{ tokenizer: unknown; model: unknown }> {
  const pretrainedOptions = {
    revision: options.revision,
    dtype: options.dtype,
    device: options.device,
    local_files_only: false,
    progress_callback: progressCallback,
  };
  const tokenizerLoad = options.allowDownload
    ? loaders.AutoTokenizer.from_pretrained(options.model, pretrainedOptions)
    : caches
        .open("bookmark-x-transformers-v1")
        .then((cache) =>
          loadPinnedTokenizerFromCache(
            cache,
            (tokenizer, config) => new loaders.XLMRobertaTokenizer(tokenizer, config),
          ),
        );
  const [tokenizer, model] = await Promise.all([
    tokenizerLoad,
    loaders.AutoModel.from_pretrained(options.model, pretrainedOptions),
  ]);
  return { tokenizer, model };
}

export function modelAccessPolicy(allowDownload: boolean): {
  allowRemoteModels: true;
  localFilesOnly: false;
  networkAllowed: boolean;
} {
  // Transformers.js v4 checks Browser Cache on the remote-model path.
  // `local_files_only` refers to filesystem-local models and cannot be combined
  // with the browser default of `allowLocalModels = false`.
  return {
    allowRemoteModels: true,
    localFilesOnly: false,
    networkAllowed: allowDownload,
  };
}

const loadTransformersPipeline: PipelineLoader = async (options) => {
  const transformers = await import("@huggingface/transformers");
  const onnx = transformers.env.backends.onnx;
  const wasm = onnx.wasm;
  if (wasm === undefined) throw new Error("The packaged WASM backend is unavailable.");
  const access = modelAccessPolicy(options.allowDownload);
  // Browser Cache Storage is populated and read through the remote-model path.
  // For cache-only loads, a synthetic miss prevents an actual network request
  // while preserving Transformers.js's cache lookup before fetch.
  transformers.env.allowRemoteModels = access.allowRemoteModels;
  transformers.env.allowLocalModels = false;
  transformers.env.fetch = access.networkAllowed
    ? globalThis.fetch.bind(globalThis)
    : () =>
        Promise.resolve(new Response(null, { status: 404, statusText: "Cache miss" }));
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

  const components = await loadPinnedComponents(
    transformers,
    options,
    progress_callback,
  );
  // Avoid pipeline()'s online metadata autodetection. In Transformers.js v4,
  // that probe is not persisted in Browser Cache and can omit the tokenizer
  // when a fresh worker loads an otherwise complete model cache offline.
  return new transformers.FeatureExtractionPipeline({
    task: "feature-extraction",
    model: components.model,
    tokenizer: components.tokenizer,
  } as never) as unknown as FeatureExtractionPipeline;
};

const probeWebGpu: WebGpuProbe = async () => {
  if (typeof navigator === "undefined") return false;
  const gpu = (
    navigator as Navigator & {
      gpu?: { requestAdapter(): Promise<object | null> };
    }
  ).gpu;
  if (gpu === undefined) return false;
  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
};

export class TransformersEmbeddingModel implements EmbeddingModel {
  private active: FeatureExtractionPipeline | null = null;

  constructor(
    private readonly loader: PipelineLoader = loadTransformersPipeline,
    private readonly webGpuAvailable: WebGpuProbe = probeWebGpu,
  ) {}

  async load(
    allowDownload: boolean,
    onProgress?: (progress: SemanticProgress) => void,
    forceWasm = false,
  ): Promise<SemanticBackend> {
    if (this.active !== null) throw new Error("The semantic model is already loaded.");
    const common = {
      model: MODEL_ID,
      revision: MODEL_REVISION,
      dtype: MODEL_DTYPE,
      allowDownload,
      ...(onProgress === undefined ? {} : { onProgress }),
    } as const;
    if (!forceWasm && (await this.webGpuAvailable().catch(() => false))) {
      try {
        this.active = await this.loader({ ...common, device: "webgpu" });
        return "webgpu";
      } catch (error) {
        // ONNX Runtime is a singleton within a worker. A failed WebGPU session can
        // leave it unusable, so the client retries WASM in a fresh worker instead.
        throw new WebGpuPipelineLoadError(error);
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
