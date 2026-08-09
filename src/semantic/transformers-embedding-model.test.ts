import { describe, expect, it, vi } from "vitest";

import {
  MODEL_ID,
  MODEL_REVISION,
  TransformersEmbeddingModel,
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
  it("pins the quantized model revision and prevents network use without consent", async () => {
    const loaded: PipelineLoadOptions[] = [];
    const instance = pipeline();
    const model = new TransformersEmbeddingModel(async (options) => {
      loaded.push(options);
      return instance;
    }, false);

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

  it("falls back from WebGPU to local WASM without changing model or quantization", async () => {
    const loaded: PipelineLoadOptions[] = [];
    const fallback = pipeline();
    const model = new TransformersEmbeddingModel(async (options) => {
      loaded.push(options);
      if (options.device === "webgpu") throw new Error("adapter unavailable");
      return fallback;
    }, true);

    await expect(model.load(true)).resolves.toBe("wasm");
    expect(loaded.map(({ device }) => device)).toEqual(["webgpu", "wasm"]);
    expect(loaded.every(({ dtype }) => dtype === "q8")).toBe(true);
    expect(loaded.every(({ allowDownload }) => allowDownload)).toBe(true);
  });

  it("normalizes output vectors and disposes the active ONNX sessions", async () => {
    const instance = pipeline();
    const dispose = vi.spyOn(instance, "dispose");
    const model = new TransformersEmbeddingModel(async () => instance, false);
    await model.load(false);

    await expect(
      model.embedPassages(["passage: one", "passage: two"]),
    ).resolves.toEqual([new Float32Array([1, 2]), new Float32Array([2, 3])]);
    await model.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
