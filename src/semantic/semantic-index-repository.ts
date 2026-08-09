import type { SearchBookmarkView } from "../domain/search-bookmarks";
import type { BookmarkRecord } from "../domain/types";

const DATABASE_VERSION = 1;
export const SEMANTIC_INDEX_DATABASE_NAME = "bookmark-x-semantic";
const EMBEDDINGS_STORE = "embeddings";
const META_STORE = "meta";
const DIMENSIONS_KEY = "dimensions";

export interface StoredSemanticEmbedding {
  id: string;
  fingerprint: string;
  bookmark: BookmarkRecord;
  vector: Float32Array;
}

export interface SemanticIndexStats {
  entries: number;
  dimensions: number;
  estimatedVectorBytes: number;
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("IndexedDB request failed."));
  });
}

function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Semantic index transaction aborted."));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Semantic index transaction failed."));
  });
}

function validateEmbeddings(
  embeddings: readonly StoredSemanticEmbedding[],
  expectedDimensions?: number,
): number {
  let dimensions = expectedDimensions ?? embeddings[0]?.vector.length ?? 0;
  for (const embedding of embeddings) {
    if (
      embedding.id.length === 0 ||
      embedding.fingerprint.length === 0 ||
      embedding.id !== embedding.bookmark.id
    ) {
      throw new TypeError("Semantic embedding identifiers must be consistent.");
    }
    if (dimensions === 0) dimensions = embedding.vector.length;
    if (embedding.vector.length !== dimensions) {
      throw new TypeError("Semantic embedding dimensions must be consistent.");
    }
    if (!embedding.vector.every(Number.isFinite)) {
      throw new TypeError("Semantic embedding values must be finite.");
    }
  }
  return dimensions;
}

function isInbox(bookmark: BookmarkRecord): boolean {
  return (
    bookmark.status === "current" &&
    (bookmark.note.length === 0 ||
      bookmark.tagIds.length === 0 ||
      bookmark.folderId === null)
  );
}

function visible(bookmark: BookmarkRecord, view: SearchBookmarkView): boolean {
  if (view === "archived") return bookmark.status === "archived";
  if (view === "inbox") return isInbox(bookmark);
  return bookmark.status === "current";
}

function cosine(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) return Number.NEGATIVE_INFINITY;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return Number.NEGATIVE_INFINITY;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export class SemanticIndexRepository {
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly databaseName = SEMANTIC_INDEX_DATABASE_NAME) {}

  async getAll(): Promise<StoredSemanticEmbedding[]> {
    const database = await this.open();
    const transaction = database.transaction(EMBEDDINGS_STORE, "readonly");
    const result = await request(
      transaction.objectStore(EMBEDDINGS_STORE).getAll() as IDBRequest<
        StoredSemanticEmbedding[]
      >,
    );
    await completed(transaction);
    return result;
  }

  async replace(embeddings: readonly StoredSemanticEmbedding[]): Promise<void> {
    const dimensions = validateEmbeddings(embeddings);
    const database = await this.open();
    const transaction = database.transaction(
      [EMBEDDINGS_STORE, META_STORE],
      "readwrite",
    );
    const store = transaction.objectStore(EMBEDDINGS_STORE);
    store.clear();
    for (const embedding of embeddings) store.put(embedding);
    transaction.objectStore(META_STORE).put({ key: DIMENSIONS_KEY, value: dimensions });
    await completed(transaction);
  }

  async applyChanges(
    upserts: readonly StoredSemanticEmbedding[],
    removedIds: readonly string[],
  ): Promise<void> {
    const database = await this.open();
    const read = database.transaction(META_STORE, "readonly");
    const storedDimensions = (await request(
      read.objectStore(META_STORE).get(DIMENSIONS_KEY),
    )) as { key: string; value: number } | undefined;
    await completed(read);
    const dimensions = validateEmbeddings(upserts, storedDimensions?.value);
    const transaction = database.transaction(
      [EMBEDDINGS_STORE, META_STORE],
      "readwrite",
    );
    const store = transaction.objectStore(EMBEDDINGS_STORE);
    for (const id of new Set(removedIds)) store.delete(id);
    for (const embedding of upserts) store.put(embedding);
    if (storedDimensions === undefined && dimensions > 0) {
      transaction
        .objectStore(META_STORE)
        .put({ key: DIMENSIONS_KEY, value: dimensions });
    }
    await completed(transaction);
  }

  async search(
    query: Float32Array,
    view: SearchBookmarkView,
    limit: number,
  ): Promise<StoredSemanticEmbedding[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new RangeError("Semantic search limit must be between 1 and 100.");
    }
    if (!query.every(Number.isFinite)) {
      throw new TypeError("Semantic query values must be finite.");
    }
    const embeddings = await this.getAll();
    return embeddings
      .flatMap((embedding) =>
        visible(embedding.bookmark, view)
          ? [{ embedding, score: cosine(query, embedding.vector) }]
          : [],
      )
      .filter(({ score }) => Number.isFinite(score))
      .sort((left, right) => {
        const score = right.score - left.score;
        if (score !== 0) return score;
        const saved = right.embedding.bookmark.firstSavedAt.localeCompare(
          left.embedding.bookmark.firstSavedAt,
        );
        return saved || left.embedding.id.localeCompare(right.embedding.id, "und");
      })
      .slice(0, limit)
      .map(({ embedding }) => embedding);
  }

  async stats(): Promise<SemanticIndexStats> {
    const database = await this.open();
    const transaction = database.transaction(
      [EMBEDDINGS_STORE, META_STORE],
      "readonly",
    );
    const [entries, dimensions] = await Promise.all([
      request(transaction.objectStore(EMBEDDINGS_STORE).count()),
      request(transaction.objectStore(META_STORE).get(DIMENSIONS_KEY)) as Promise<
        { key: string; value: number } | undefined
      >,
    ]);
    await completed(transaction);
    const value = dimensions?.value ?? 0;
    return {
      entries,
      dimensions: value,
      estimatedVectorBytes: entries * value * Float32Array.BYTES_PER_ELEMENT,
    };
  }

  async clear(): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(
      [EMBEDDINGS_STORE, META_STORE],
      "readwrite",
    );
    transaction.objectStore(EMBEDDINGS_STORE).clear();
    transaction.objectStore(META_STORE).clear();
    await completed(transaction);
  }

  private open(): Promise<IDBDatabase> {
    this.databasePromise ??= new Promise((resolve, reject) => {
      const opening = indexedDB.open(this.databaseName, DATABASE_VERSION);
      opening.onupgradeneeded = () => {
        const database = opening.result;
        if (!database.objectStoreNames.contains(EMBEDDINGS_STORE)) {
          database.createObjectStore(EMBEDDINGS_STORE, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(META_STORE)) {
          database.createObjectStore(META_STORE, { keyPath: "key" });
        }
      };
      opening.onsuccess = () => {
        const database = opening.result;
        database.onversionchange = () => {
          database.close();
          this.databasePromise = null;
        };
        resolve(database);
      };
      opening.onerror = () =>
        reject(opening.error ?? new Error("Could not open the semantic index."));
      opening.onblocked = () => reject(new Error("Semantic index upgrade blocked."));
    });
    return this.databasePromise;
  }
}

export function deleteSemanticIndexDatabase(
  databaseName = SEMANTIC_INDEX_DATABASE_NAME,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deletion = indexedDB.deleteDatabase(databaseName);
    deletion.onsuccess = () => resolve();
    deletion.onerror = () =>
      reject(deletion.error ?? new Error("Could not remove the semantic index."));
    deletion.onblocked = () =>
      reject(new Error("Semantic index removal was blocked by another view."));
  });
}
