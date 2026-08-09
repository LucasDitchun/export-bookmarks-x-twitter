import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import type { BookmarkRecord } from "../domain/types";
import {
  deleteSemanticIndexDatabase,
  SemanticIndexRepository,
  type StoredSemanticEmbedding,
} from "./semantic-index-repository";

const bookmark = (
  id: string,
  options: Partial<BookmarkRecord> = {},
): BookmarkRecord => ({
  id,
  url: `https://x.com/person/status/${id}`,
  text: `Post ${id}`,
  author: { id: "person", name: "Person", username: "person" },
  postCreatedAt: "2026-08-01T00:00:00.000Z",
  firstSavedAt: `2026-08-0${id}T00:00:00.000Z`,
  lastSeenAt: `2026-08-0${id}T00:00:00.000Z`,
  archivedAt: null,
  metadataUpdatedAt: `2026-08-0${id}T00:00:00.000Z`,
  status: "current",
  note: "note",
  tagIds: ["tag"],
  folderId: "folder",
  ...options,
  media: options.media ?? { images: [], videos: [] },
});

const embedding = (
  id: string,
  vector: readonly number[],
  options?: Partial<BookmarkRecord>,
): StoredSemanticEmbedding => ({
  id,
  fingerprint: `fingerprint-${id}`,
  bookmark: bookmark(id, options),
  vector: new Float32Array(vector),
});

describe("SemanticIndexRepository", () => {
  it("atomically upserts changed embeddings and removes missing bookmarks", async () => {
    const repository = new SemanticIndexRepository(`semantic-${crypto.randomUUID()}`);
    await repository.replace([embedding("1", [1, 0]), embedding("2", [0, 1])]);
    await repository.applyChanges([embedding("1", [0.5, 0.5])], ["2"]);

    expect(await repository.getAll()).toEqual([
      expect.objectContaining({ id: "1", fingerprint: "fingerprint-1" }),
    ]);
  });

  it("ranks normalized vectors by cosine similarity and filters each library view", async () => {
    const repository = new SemanticIndexRepository(`semantic-${crypto.randomUUID()}`);
    await repository.replace([
      embedding("1", [1, 0]),
      embedding("2", [0.8, 0.2], { note: "", tagIds: [], folderId: null }),
      embedding("3", [0, 1], { status: "archived" }),
    ]);

    await expect(
      repository.search(new Float32Array([1, 0]), "current", 10),
    ).resolves.toMatchObject([{ id: "1" }, { id: "2" }]);
    await expect(
      repository.search(new Float32Array([1, 0]), "inbox", 10),
    ).resolves.toMatchObject([{ id: "2" }]);
    await expect(
      repository.search(new Float32Array([0, 1]), "archived", 10),
    ).resolves.toMatchObject([{ id: "3" }]);
  });

  it("rejects invalid vectors and reports deterministic storage estimates", async () => {
    const repository = new SemanticIndexRepository(`semantic-${crypto.randomUUID()}`);
    await expect(repository.replace([embedding("1", [Number.NaN, 1])])).rejects.toThrow(
      "finite",
    );
    await repository.replace([embedding("1", [1, 0, 0])]);

    await expect(repository.stats()).resolves.toEqual({
      entries: 1,
      dimensions: 3,
      estimatedVectorBytes: 12,
    });
    await repository.clear();
    await expect(repository.getAll()).resolves.toEqual([]);
  });

  it("deletes the dedicated index database after closing open views", async () => {
    const databaseName = `semantic-${crypto.randomUUID()}`;
    const repository = new SemanticIndexRepository(databaseName);
    await repository.replace([embedding("1", [1, 0])]);

    await deleteSemanticIndexDatabase(databaseName);

    const reopened = new SemanticIndexRepository(databaseName);
    await expect(reopened.stats()).resolves.toEqual({
      entries: 0,
      dimensions: 0,
      estimatedVectorBytes: 0,
    });
  });
});
