import type { SemanticSourceDocument } from "../domain/semantic-search";
import type { SearchBookmarkView } from "../domain/search-bookmarks";
import type { BookmarkRecord } from "../domain/types";
import { deleteSemanticIndexDatabase } from "./semantic-index-repository";
import type {
  SemanticStateRepository,
  SemanticSearchState,
} from "./semantic-state-repository";
import type { SemanticProgress, SemanticBackend } from "./semantic-worker-runtime";
import type {
  SemanticWorkerRequest,
  SemanticWorkerResponse,
} from "./semantic-worker-protocol";

export const TRANSFORMERS_CACHE_KEY = "bookmark-x-transformers-v1";

export interface SemanticWorkerLike {
  postMessage(message: SemanticWorkerRequest): void;
  addEventListener(
    type: "message" | "error" | "messageerror",
    listener: (event: MessageEvent<SemanticWorkerResponse> | Event) => void,
  ): void;
  removeEventListener(
    type: "message" | "error" | "messageerror",
    listener: (event: MessageEvent<SemanticWorkerResponse> | Event) => void,
  ): void;
  terminate(): void;
}

interface CacheRemover {
  delete(cacheName: string): Promise<boolean>;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(reason: Error): void;
}

class SemanticWorkerResponseError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SemanticWorkerResponseError";
  }
}

export class SemanticOperationCancelledError extends Error {
  constructor() {
    super("Semantic search operation cancelled.");
    this.name = "SemanticOperationCancelledError";
  }
}

export class SemanticSearchClient {
  private worker: SemanticWorkerLike | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly progressListeners = new Set<(progress: SemanticProgress) => void>();
  private readonly cache: CacheRemover;
  private requestSequence = 0;
  private operationGeneration = 0;

  constructor(
    private readonly state: SemanticStateRepository,
    private readonly loadCorpus: () => Promise<SemanticSourceDocument[]>,
    private readonly createWorker: () => SemanticWorkerLike,
    cache?: CacheRemover,
    private readonly removeIndex = deleteSemanticIndexDatabase,
  ) {
    this.cache =
      cache ??
      (typeof caches === "undefined"
        ? { delete: () => Promise.resolve(false) }
        : caches);
  }

  getState(): Promise<SemanticSearchState> {
    return this.state.get();
  }

  subscribe(listener: (progress: SemanticProgress) => void): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  async installWithConsent(): Promise<SemanticSearchState> {
    const generation = this.operationGeneration;
    await this.state.beginConsentInstall();
    try {
      this.assertCurrent(generation);
      const { backend } = await this.loadWithFallback(true);
      this.assertCurrent(generation);
      await this.state.markIndexing(backend);
      const documents = await this.loadCorpus();
      this.assertCurrent(generation);
      const synced = await this.request<{ total: number }>("SYNC", { documents });
      return await this.state.markReady(backend, synced.total);
    } catch (error) {
      if (error instanceof SemanticOperationCancelledError) throw error;
      await this.state.markError("model_install_failed");
      throw error;
    }
  }

  async reindex(): Promise<SemanticSearchState> {
    const generation = this.operationGeneration;
    const current = await this.state.get();
    if (current.consentGrantedAt === null) {
      throw new Error("Semantic search requires explicit consent.");
    }
    try {
      this.assertCurrent(generation);
      const { backend } = await this.loadWithFallback(false);
      this.assertCurrent(generation);
      await this.state.markIndexing(backend);
      const documents = await this.loadCorpus();
      this.assertCurrent(generation);
      const synced = await this.request<{ total: number }>("SYNC", { documents });
      return await this.state.markReady(backend, synced.total);
    } catch (error) {
      if (error instanceof SemanticOperationCancelledError) throw error;
      await this.state.markError("model_reindex_failed");
      throw error;
    }
  }

  async search(
    query: string,
    view: SearchBookmarkView,
    limit: number,
  ): Promise<BookmarkRecord[] | null> {
    const current = await this.state.get();
    if (
      !current.enabled ||
      current.consentGrantedAt === null ||
      current.modelStatus !== "ready"
    ) {
      return null;
    }
    try {
      await this.loadWithFallback(false);
      const documents = await this.loadCorpus();
      await this.request("SYNC", { documents });
      return await this.request<BookmarkRecord[]>("SEARCH", { query, view, limit });
    } catch {
      // Semantic search is an optional enhancement. Lexical search must continue
      // to work offline and after model/backend failures.
      return null;
    }
  }

  async setEnabled(enabled: boolean): Promise<SemanticSearchState> {
    return this.state.setEnabled(enabled);
  }

  async cancel(): Promise<void> {
    this.operationGeneration += 1;
    const error = new SemanticOperationCancelledError();
    this.rejectAll(error);
    this.destroyWorker();
    await this.state.markCancelled();
  }

  async remove(): Promise<void> {
    this.operationGeneration += 1;
    this.rejectAll(new SemanticOperationCancelledError());
    this.destroyWorker();
    const [indexResult, cacheResult] = await Promise.allSettled([
      this.removeIndex(),
      this.cache.delete(TRANSFORMERS_CACHE_KEY),
    ]);
    await this.state.reset();
    if (indexResult.status === "rejected") {
      throw new Error("Could not remove the local semantic index.");
    }
    if (cacheResult.status === "rejected") {
      throw new Error("Could not remove the local semantic model cache.");
    }
  }

  destroy(): void {
    this.operationGeneration += 1;
    this.rejectAll(new SemanticOperationCancelledError());
    this.destroyWorker();
  }

  private request<T = unknown>(
    type: SemanticWorkerRequest["type"],
    payload: Record<string, unknown>,
  ): Promise<T> {
    const requestId = `semantic-${Date.now()}-${++this.requestSequence}`;
    const message = { requestId, type, ...payload } as SemanticWorkerRequest;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      try {
        this.getWorker().postMessage(message);
      } catch (error) {
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error("Semantic worker failed."));
      }
    });
  }

  private async loadWithFallback(
    allowDownload: boolean,
  ): Promise<{ backend: SemanticBackend }> {
    try {
      return await this.request<{ backend: SemanticBackend }>("LOAD", {
        allowDownload,
      });
    } catch (error) {
      if (
        !(error instanceof SemanticWorkerResponseError) ||
        error.code !== "semantic_webgpu_failed"
      ) {
        throw error;
      }
      this.destroyWorker();
      return this.request<{ backend: SemanticBackend }>("LOAD", {
        allowDownload,
        forceWasm: true,
      });
    }
  }

  private getWorker(): SemanticWorkerLike {
    if (this.worker === null) {
      this.worker = this.createWorker();
      this.worker.addEventListener("message", this.handleMessage);
      this.worker.addEventListener("error", this.handleWorkerFailure);
      this.worker.addEventListener("messageerror", this.handleWorkerFailure);
    }
    return this.worker;
  }

  private readonly handleMessage = (
    event: MessageEvent<SemanticWorkerResponse> | Event,
  ): void => {
    if (!("data" in event)) return;
    const response = event.data;
    if (response.kind === "progress") {
      for (const listener of this.progressListeners) listener(response.progress);
      return;
    }
    const pending = this.pending.get(response.requestId);
    if (pending === undefined) return;
    this.pending.delete(response.requestId);
    if (response.ok) pending.resolve(response.data);
    else pending.reject(new SemanticWorkerResponseError(response.error.code));
  };

  private readonly handleWorkerFailure = (): void => {
    this.rejectAll(new Error("Semantic worker failed."));
    this.destroyWorker();
  };

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private destroyWorker(): void {
    if (this.worker === null) return;
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.removeEventListener("error", this.handleWorkerFailure);
    this.worker.removeEventListener("messageerror", this.handleWorkerFailure);
    this.worker.terminate();
    this.worker = null;
  }

  private assertCurrent(generation: number): void {
    if (generation !== this.operationGeneration) {
      throw new SemanticOperationCancelledError();
    }
  }
}
