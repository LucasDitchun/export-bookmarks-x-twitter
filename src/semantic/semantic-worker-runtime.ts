import {
  buildSemanticPassage,
  semanticDocumentFingerprint,
  type SemanticSourceDocument,
} from "../domain/semantic-search";
import type { SearchBookmarkView } from "../domain/search-bookmarks";
import type { BookmarkRecord } from "../domain/types";
import {
  SemanticIndexRepository,
  type StoredSemanticEmbedding,
} from "./semantic-index-repository";

const INDEX_BATCH_SIZE = 16;

export type SemanticBackend = "webgpu" | "wasm";

export interface SemanticProgress {
  phase: "loading" | "downloading" | "indexing" | "ready";
  completed: number;
  total: number;
  file?: string;
}

export interface EmbeddingModel {
  load(
    allowDownload: boolean,
    onProgress?: (progress: SemanticProgress) => void,
    forceWasm?: boolean,
  ): Promise<SemanticBackend>;
  embedPassages(values: readonly string[]): Promise<Float32Array[]>;
  embedQuery(value: string): Promise<Float32Array>;
  dispose(): Promise<void>;
}

export class SemanticWorkerRuntime {
  private backend: SemanticBackend | null = null;
  private loading: Promise<SemanticBackend> | null = null;

  constructor(
    private readonly model: EmbeddingModel,
    private readonly repository = new SemanticIndexRepository(),
    private readonly onProgress: (progress: SemanticProgress) => void = () => {},
  ) {}

  async load(
    allowDownload: boolean,
    forceWasm = false,
  ): Promise<{ backend: SemanticBackend }> {
    if (this.backend === null) {
      if (this.loading === null) {
        this.onProgress({ phase: "loading", completed: 0, total: 1 });
        this.loading = this.model.load(allowDownload, this.onProgress, forceWasm);
      }
      try {
        this.backend = await this.loading;
        this.onProgress({ phase: "ready", completed: 1, total: 1 });
      } finally {
        this.loading = null;
      }
    }
    return { backend: this.backend };
  }

  async synchronize(documents: readonly SemanticSourceDocument[]): Promise<{
    indexed: number;
    removed: number;
    total: number;
  }> {
    this.assertLoaded();
    const existing = await this.repository.getAll();
    const existingById = new Map(existing.map((entry) => [entry.id, entry]));
    const sourceIds = new Set(documents.map(({ bookmark }) => bookmark.id));
    const removed = existing.filter(({ id }) => !sourceIds.has(id)).map(({ id }) => id);
    const fingerprints = await Promise.all(
      documents.map(async (document) => ({
        document,
        fingerprint: await semanticDocumentFingerprint(document),
      })),
    );
    const changed = fingerprints.filter(
      ({ document, fingerprint }) =>
        existingById.get(document.bookmark.id)?.fingerprint !== fingerprint,
    );

    const upserts: StoredSemanticEmbedding[] = [];
    for (let offset = 0; offset < changed.length; offset += INDEX_BATCH_SIZE) {
      const batch = changed.slice(offset, offset + INDEX_BATCH_SIZE);
      const vectors = await this.model.embedPassages(
        batch.map(({ document }) => buildSemanticPassage(document)),
      );
      if (vectors.length !== batch.length) {
        throw new Error("The semantic model returned an unexpected embedding count.");
      }
      for (let index = 0; index < batch.length; index += 1) {
        const current = batch[index]!;
        upserts.push({
          id: current.document.bookmark.id,
          fingerprint: current.fingerprint,
          bookmark: structuredClone(current.document.bookmark),
          vector: vectors[index]!,
        });
      }
      this.onProgress({
        phase: "indexing",
        completed: Math.min(offset + batch.length, changed.length),
        total: changed.length,
      });
    }

    await this.repository.applyChanges(upserts, removed);
    return {
      indexed: changed.length,
      removed: removed.length,
      total: documents.length,
    };
  }

  async search(
    query: string,
    view: SearchBookmarkView,
    limit: number,
  ): Promise<BookmarkRecord[]> {
    this.assertLoaded();
    const normalized = query.replace(/\s+/gu, " ").trim();
    if (normalized.length === 0) return [];
    const vector = await this.model.embedQuery(`query: ${normalized}`);
    return (await this.repository.search(vector, view, limit)).map(
      ({ bookmark }) => bookmark,
    );
  }

  stats() {
    return this.repository.stats();
  }

  clear(): Promise<void> {
    return this.repository.clear();
  }

  async dispose(): Promise<void> {
    this.backend = null;
    this.loading = null;
    await this.model.dispose();
  }

  private assertLoaded(): void {
    if (this.backend === null) throw new Error("The semantic model is not loaded.");
  }
}
