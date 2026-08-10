import { describe, expect, it, vi } from "vitest";

import {
  MODEL_ID,
  MODEL_REVISION,
  TransformersEmbeddingModel,
  WebGpuPipelineLoadError,
  loadPinnedComponents,
  loadPinnedTokenizerFromCache,
  modelAccessPolicy,
  type FeatureExtractionPipeline,
  type PipelineLoadOptions,
} from "./transformers-embedding-model";

function pipeline(): FeatureExtractionPipeline {
  const run = vi.fn(async (values: readonly string[]) => ({
    tolist: () => values.map((_, index) => [index + 1, index + 2]),
  }));
  return Object.assign(run, { dispose: vi.fn(async () => {}) });
}

describe("TransformersEmbeddingModel", () => {
  it("loads pinned tokenizer and model directly without online pipeline discovery", async () => {
    const tokenizer = { kind: "tokenizer" };
    const model = { kind: "model" };
    const AutoTokenizer = { from_pretrained: vi.fn(async () => tokenizer) };
    const AutoModel = { from_pretrained: vi.fn(async () => model) };
    class XLMRobertaTokenizer {}
    const progress = vi.fn();

    await expect(
      loadPinnedComponents(
        { AutoTokenizer, AutoModel, XLMRobertaTokenizer },
        {
          model: MODEL_ID,
          revision: MODEL_REVISION,
          dtype: "q8",
          device: "wasm",
          allowDownload: true,
        },
        progress,
      ),
    ).resolves.toEqual({ tokenizer, model });
    const expected = {
      revision: MODEL_REVISION,
      dtype: "q8",
      device: "wasm",
      local_files_only: false,
      progress_callback: progress,
    };
    expect(AutoTokenizer.from_pretrained).toHaveBeenCalledWith(MODEL_ID, expected);
    expect(AutoModel.from_pretrained).toHaveBeenCalledWith(MODEL_ID, expected);
  });

  it("reconstructs the pinned tokenizer from Browser Cache without fetch", async () => {
    const tokenizerJson = { model: "tokenizer" };
    const tokenizerConfig = { tokenizer_class: "XLMRobertaTokenizer" };
    const match = vi.fn(async (request: string) => {
      if (request.endsWith("/tokenizer.json")) {
        return new Response(JSON.stringify(tokenizerJson));
      }
      if (request.endsWith("/tokenizer_config.json")) {
        return new Response(JSON.stringify(tokenizerConfig));
      }
      return undefined;
    });
    const create = vi.fn((tokenizer: unknown, config: unknown) => ({
      tokenizer,
      config,
    }));

    await expect(loadPinnedTokenizerFromCache({ match }, create)).resolves.toEqual({
      tokenizer: tokenizerJson,
      config: tokenizerConfig,
    });
    expect(match).toHaveBeenCalledTimes(2);
    expect(match.mock.calls.every(([url]) => url.includes(MODEL_REVISION))).toBe(true);
  });

  it("keeps the browser-cache route enabled while cache-only loads forbid network", () => {
    expect(modelAccessPolicy(true)).toEqual({
      allowRemoteModels: true,
      localFilesOnly: false,
      networkAllowed: true,
    });
    expect(modelAccessPolicy(false)).toEqual({
      allowRemoteModels: true,
      localFilesOnly: false,
      networkAllowed: false,
    });
  });

  it("pins the quantized model revision and prevents network use without consent", async () => {
    const loaded: PipelineLoadOptions[] = [];
    const instance = pipeline();
    const model = new TransformersEmbeddingModel(
      async (options) => {
        loaded.push(options);
        return instance;
      },
      async () => false,
    );

    await expect(model.load(false)).resolves.toBe("wasm");
    expect(loaded).toEqual([
      expect.objectContaining({
        model: MODEL_ID,
        revision: MODEL_REVISION,
        device: "wasm",
        dtype: "q8",
        allowDownload: false,
      }),
    ]);
    await model.embedQuery("query: local only");
    expect(instance).toHaveBeenCalledWith(["query: local only"], {
      pooling: "mean",
      normalize: true,
    });
  });

  it.each([
    ["missing", async () => false],
    ["rejected", async () => Promise.reject(new Error("adapter unavailable"))],
  ])("uses WASM directly when the WebGPU adapter is %s", async (_, probe) => {
    const loaded: PipelineLoadOptions[] = [];
    const fallback = pipeline();
    const model = new TransformersEmbeddingModel(async (options) => {
      loaded.push(options);
      return fallback;
    }, probe);

    await expect(model.load(true)).resolves.toBe("wasm");
    expect(loaded.map(({ device }) => device)).toEqual(["wasm"]);
    expect(loaded.every(({ dtype }) => dtype === "q8")).toBe(true);
    expect(loaded.every(({ allowDownload }) => allowDownload)).toBe(true);
  });

  it("leaves a failed WebGPU pipeline for a clean worker to retry", async () => {
    const loaded: PipelineLoadOptions[] = [];
    const model = new TransformersEmbeddingModel(
      async (options) => {
        loaded.push(options);
        throw new Error("session failed");
      },
      async () => true,
    );

    const loading = model.load(true);
    const error: unknown = await loading.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(WebGpuPipelineLoadError);
    if (!(error instanceof WebGpuPipelineLoadError)) throw error;
    expect(error.cause).toMatchObject({ message: "session failed" });
    expect(loaded.map(({ device }) => device)).toEqual(["webgpu"]);
  });

  it("normalizes output vectors and disposes the active ONNX sessions", async () => {
    const instance = pipeline();
    const dispose = vi.spyOn(instance, "dispose");
    const model = new TransformersEmbeddingModel(
      async () => instance,
      async () => false,
    );
    await model.load(false);

    await expect(
      model.embedPassages(["passage: one", "passage: two"]),
    ).resolves.toEqual([new Float32Array([1, 2]), new Float32Array([2, 3])]);
    await model.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
