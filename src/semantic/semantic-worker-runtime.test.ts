import "fake-indexeddb/auto";

import { describe, expect, it, vi } from "vitest";

import type { SemanticSourceDocument } from "../domain/semantic-search";
import type { BookmarkRecord } from "../domain/types";
import { SemanticIndexRepository } from "./semantic-index-repository";
import {
  SemanticWorkerRuntime,
  type EmbeddingModel,
  type SemanticProgress,
} from "./semantic-worker-runtime";

const bookmark = (id: string, text = `Post ${id}`): BookmarkRecord => ({
  id,
  url: `https://x.com/person/status/${id}`,
  text,
  author: { id: "person", name: "Person", username: "person" },
  postCreatedAt: "2026-08-01T00:00:00.000Z",
  firstSavedAt: `2026-08-0${id}T00:00:00.000Z`,
  lastSeenAt: `2026-08-0${id}T00:00:00.000Z`,
  archivedAt: null,
  metadataUpdatedAt: `2026-08-0${id}T00:00:00.000Z`,
  status: "current",
  note: "remember this",
  tagIds: ["tag"],
  folderId: "folder",
  media: { images: [], videos: [] },
});

const document = (id: string, text?: string): SemanticSourceDocument => ({
  bookmark: bookmark(id, text),
  tagNames: ["Research"],
  folderBreadcrumb: ["Engineering", "AI"],
});

class FakeModel implements EmbeddingModel {
  readonly loads: boolean[] = [];
  readonly passages: string[][] = [];
  readonly queries: string[] = [];
  disposed = false;

  async load(allowDownload: boolean): Promise<"webgpu" | "wasm"> {
    this.loads.push(allowDownload);
    return "webgpu";
  }

  async embedPassages(values: readonly string[]): Promise<Float32Array[]> {
    this.passages.push([...values]);
    return values.map((value) =>
      value.includes("Post 1") ? new Float32Array([1, 0]) : new Float32Array([0, 1]),
    );
  }

  async embedQuery(value: string): Promise<Float32Array> {
    this.queries.push(value);
    return new Float32Array([1, 0]);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

describe("SemanticWorkerRuntime", () => {
  it("never enables downloads unless the caller explicitly allows them", async () => {
    const model = new FakeModel();
    const runtime = new SemanticWorkerRuntime(
      model,
      new SemanticIndexRepository(`runtime-${crypto.randomUUID()}`),
    );

    await expect(
      Promise.all([runtime.load(false), runtime.load(false)]),
    ).resolves.toEqual([{ backend: "webgpu" }, { backend: "webgpu" }]);
    await expect(runtime.load(true)).resolves.toEqual({ backend: "webgpu" });
    expect(model.loads).toEqual([false]);
  });

  it("indexes only changed passages, removes missing posts, and emits progress", async () => {
    const model = new FakeModel();
    const progress: SemanticProgress[] = [];
    const repository = new SemanticIndexRepository(`runtime-${crypto.randomUUID()}`);
    const runtime = new SemanticWorkerRuntime(model, repository, (event) =>
      progress.push(event),
    );
    await runtime.load(false);
    await runtime.synchronize([document("1"), document("2")]);
    await runtime.synchronize([document("1", "Post 1 changed")]);

    expect(model.passages).toHaveLength(2);
    expect(model.passages[0]).toEqual([
      expect.stringContaining("passage: Post 1"),
      expect.stringContaining("passage: Post 2"),
    ]);
    expect(model.passages[1]).toEqual([
      expect.stringContaining("passage: Post 1 changed"),
    ]);
    expect((await repository.getAll()).map(({ id }) => id)).toEqual(["1"]);
    expect(progress).toContainEqual(
      expect.objectContaining({ phase: "indexing", completed: 1, total: 1 }),
    );
  });

  it("searches with the E5 query prefix and returns local bookmark snapshots", async () => {
    const model = new FakeModel();
    const runtime = new SemanticWorkerRuntime(
      model,
      new SemanticIndexRepository(`runtime-${crypto.randomUUID()}`),
    );
    await runtime.load(false);
    await runtime.synchronize([document("1"), document("2")]);

    await expect(runtime.search("what I remember", "current", 10)).resolves.toEqual([
      expect.objectContaining({ id: "1" }),
      expect.objectContaining({ id: "2" }),
    ]);
    expect(model.queries).toEqual(["query: what I remember"]);
    await runtime.dispose();
    expect(model.disposed).toBe(true);
  });

  it("does not mutate the index when embedding a synchronization batch fails", async () => {
    const model = new FakeModel();
    const repository = new SemanticIndexRepository(`runtime-${crypto.randomUUID()}`);
    const runtime = new SemanticWorkerRuntime(model, repository);
    await runtime.load(false);
    await runtime.synchronize([document("1")]);
    vi.spyOn(model, "embedPassages").mockRejectedValueOnce(new Error("model failed"));

    await expect(runtime.synchronize([document("2")])).rejects.toThrow("model failed");
    expect((await repository.getAll()).map(({ id }) => id)).toEqual(["1"]);
  });
});
