import { describe, expect, it, vi } from "vitest";

import type { SemanticSourceDocument } from "../domain/semantic-search";
import type { BookmarkRecord } from "../domain/types";
import {
  SemanticSearchClient,
  type SemanticWorkerLike,
} from "./semantic-search-client";
import { SemanticStateRepository } from "./semantic-state-repository";
import type {
  SemanticWorkerRequest,
  SemanticWorkerResponse,
} from "./semantic-worker-protocol";

class MemoryStorage {
  values: Record<string, unknown> = {};
  async get(key: string) {
    return { [key]: this.values[key] };
  }
  async set(items: Record<string, unknown>) {
    Object.assign(this.values, structuredClone(items));
  }
}

class FakeWorker implements SemanticWorkerLike {
  readonly requests: SemanticWorkerRequest[] = [];
  terminated = false;
  private listeners = new Map<
    "message" | "error" | "messageerror",
    Set<(event: MessageEvent<SemanticWorkerResponse> | Event) => void>
  >();

  postMessage(request: SemanticWorkerRequest): void {
    this.requests.push(request);
    queueMicrotask(() => {
      const data =
        request.type === "LOAD"
          ? { backend: "wasm" as const }
          : request.type === "SYNC"
            ? {
                indexed: request.documents.length,
                removed: 0,
                total: request.documents.length,
              }
            : request.type === "SEARCH"
              ? [bookmark("1")]
              : request.type === "STATS"
                ? { entries: 1, dimensions: 384, estimatedVectorBytes: 1536 }
                : undefined;
      this.emit({ kind: "result", requestId: request.requestId, ok: true, data });
    });
  }

  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: (event: MessageEvent<SemanticWorkerResponse> | Event) => void,
  ): void {
    const current = this.listeners.get(type) ?? new Set();
    current.add(listener);
    this.listeners.set(type, current);
  }

  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: (event: MessageEvent<SemanticWorkerResponse> | Event) => void,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  emit(data: SemanticWorkerResponse): void {
    for (const listener of this.listeners.get("message") ?? []) {
      listener({ data } as MessageEvent);
    }
  }

  fail(type: "error" | "messageerror" = "error"): void {
    for (const listener of this.listeners.get(type) ?? []) listener(new Event(type));
  }
}

function bookmark(id: string): BookmarkRecord {
  return {
    id,
    url: `https://x.com/person/status/${id}`,
    text: `Post ${id}`,
    author: { id: "person", name: "Person", username: "person" },
    postCreatedAt: "2026-08-01T00:00:00.000Z",
    firstSavedAt: "2026-08-01T00:00:00.000Z",
    lastSeenAt: "2026-08-01T00:00:00.000Z",
    archivedAt: null,
    metadataUpdatedAt: "2026-08-01T00:00:00.000Z",
    status: "current",
    note: "",
    tagIds: [],
    folderId: null,
    media: { images: [], videos: [] },
  };
}

const corpus: SemanticSourceDocument[] = [
  { bookmark: bookmark("1"), tagNames: [], folderBreadcrumb: [] },
];

describe("SemanticSearchClient", () => {
  it("keeps search lexical-only before explicit consent", async () => {
    const factory = vi.fn(() => new FakeWorker());
    const client = new SemanticSearchClient(
      new SemanticStateRepository(new MemoryStorage()),
      async () => corpus,
      factory,
    );

    await expect(client.search("remember", "current", 20)).resolves.toBeNull();
    expect(factory).not.toHaveBeenCalled();
  });

  it("downloads only through the explicit install action and indexes the local corpus", async () => {
    const worker = new FakeWorker();
    const state = new SemanticStateRepository(
      new MemoryStorage(),
      () => new Date("2026-08-09T10:00:00.000Z"),
    );
    const client = new SemanticSearchClient(
      state,
      async () => corpus,
      () => worker,
    );

    await expect(client.installWithConsent()).resolves.toMatchObject({
      modelStatus: "ready",
      backend: "wasm",
      indexedBookmarks: 1,
      enabled: true,
    });
    expect(worker.requests.map(({ type }) => type)).toEqual(["LOAD", "SYNC"]);
    expect(worker.requests[0]).toMatchObject({ type: "LOAD", allowDownload: true });
    await expect(client.search("remember", "current", 20)).resolves.toEqual([
      expect.objectContaining({ id: "1" }),
    ]);
    expect(worker.requests.at(-3)).toMatchObject({
      type: "LOAD",
      allowDownload: false,
    });
  });

  it("terminates the worker to cancel an active model download", async () => {
    const worker = new FakeWorker();
    const postMessage = vi.fn();
    worker.postMessage = postMessage;
    const state = new SemanticStateRepository(new MemoryStorage());
    const client = new SemanticSearchClient(
      state,
      async () => corpus,
      () => worker,
    );
    const installing = client.installWithConsent();
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());
    await client.cancel();

    await expect(installing).rejects.toThrow("cancelled");
    expect(worker.terminated).toBe(true);
    await expect(state.get()).resolves.toMatchObject({ modelStatus: "notInstalled" });
  });

  it("removes model cache and index, revokes consent, and survives offline errors", async () => {
    const worker = new FakeWorker();
    const cache = { delete: vi.fn(async () => true) };
    const removeIndex = vi.fn(async () => {});
    const state = new SemanticStateRepository(new MemoryStorage());
    const client = new SemanticSearchClient(
      state,
      async () => corpus,
      () => worker,
      cache,
      removeIndex,
    );
    await client.installWithConsent();
    await client.remove();

    expect(cache.delete).toHaveBeenCalledWith("bookmark-x-transformers-v1");
    expect(removeIndex).toHaveBeenCalledOnce();
    expect(worker.terminated).toBe(true);
    await expect(state.get()).resolves.toMatchObject({
      enabled: false,
      consentGrantedAt: null,
      modelStatus: "notInstalled",
    });
  });

  it("reindexes from the local cache only and forwards progress to subscribers", async () => {
    const worker = new FakeWorker();
    const state = new SemanticStateRepository(new MemoryStorage());
    const client = new SemanticSearchClient(
      state,
      async () => corpus,
      () => worker,
    );
    const progress = vi.fn();
    const unsubscribe = client.subscribe(progress);
    await client.installWithConsent();
    worker.emit({
      kind: "progress",
      requestId: "unrelated-progress",
      progress: { phase: "indexing", completed: 1, total: 1 },
    });
    await client.reindex();
    unsubscribe();

    expect(progress).toHaveBeenCalledWith({
      phase: "indexing",
      completed: 1,
      total: 1,
    });
    expect(worker.requests.at(-2)).toMatchObject({
      type: "LOAD",
      allowDownload: false,
    });
  });

  it("rejects cache-only reindexing before consent without creating a worker", async () => {
    const factory = vi.fn(() => new FakeWorker());
    const client = new SemanticSearchClient(
      new SemanticStateRepository(new MemoryStorage()),
      async () => corpus,
      factory,
    );

    await expect(client.reindex()).rejects.toThrow("explicit consent");
    expect(factory).not.toHaveBeenCalled();
  });

  it("records an install failure when the worker crashes and keeps later search lexical", async () => {
    const worker = new FakeWorker();
    const postMessage = vi.fn();
    worker.postMessage = postMessage;
    const state = new SemanticStateRepository(new MemoryStorage());
    const client = new SemanticSearchClient(
      state,
      async () => corpus,
      () => worker,
    );
    const installing = client.installWithConsent();
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());
    worker.fail("messageerror");

    await expect(installing).rejects.toThrow("worker failed");
    await expect(state.get()).resolves.toMatchObject({
      modelStatus: "error",
      errorCode: "model_install_failed",
    });
    await expect(client.search("still lexical", "current", 20)).resolves.toBeNull();
  });

  it("removes the index directly without starting a model worker", async () => {
    const factory = vi.fn(() => new FakeWorker());
    const cache = { delete: vi.fn(async () => true) };
    const removeIndex = vi.fn(async () => {});
    const state = new SemanticStateRepository(new MemoryStorage());
    await state.beginConsentInstall();
    const client = new SemanticSearchClient(
      state,
      async () => corpus,
      factory,
      cache,
      removeIndex,
    );

    await expect(client.remove()).resolves.toBeUndefined();
    expect(factory).not.toHaveBeenCalled();
    expect(removeIndex).toHaveBeenCalledOnce();
    expect(cache.delete).toHaveBeenCalledWith("bookmark-x-transformers-v1");
    await expect(state.get()).resolves.toMatchObject({
      enabled: false,
      consentGrantedAt: null,
      modelStatus: "notInstalled",
    });
  });
});
