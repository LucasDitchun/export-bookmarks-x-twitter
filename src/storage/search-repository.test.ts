import { describe, expect, it, vi } from "vitest";

import type { BookmarkRecord } from "../domain/types";
import {
  BOOKMARKS_STORE,
  BookmarkDatabase,
  FOLDERS_STORE,
  TAGS_STORE,
  transactionDone,
} from "./bookmark-database";
import { SearchRepository } from "./search-repository";

function bookmark(id: string, firstSavedAt: string): BookmarkRecord {
  return {
    id,
    text: `Post ${id}`,
    url: `https://x.com/person/status/${id}`,
    author: { id: "person", username: "person", name: "Person" },
    postCreatedAt: "2026-01-01T00:00:00.000Z",
    media: { images: [], videos: [] },
    note: "",
    folderId: "project",
    tagIds: ["important"],
    firstSavedAt,
    lastSeenAt: firstSavedAt,
    archivedAt: null,
    metadataUpdatedAt: firstSavedAt,
    status: "current",
  };
}

async function seed(databaseName: string): Promise<void> {
  const database = await new BookmarkDatabase(databaseName).open();
  const transaction = database.transaction(
    [BOOKMARKS_STORE, FOLDERS_STORE, TAGS_STORE],
    "readwrite",
  );
  transaction.objectStore(FOLDERS_STORE).put({
    id: "root",
    name: "Research",
    parentId: null,
  });
  transaction.objectStore(FOLDERS_STORE).put({
    id: "project",
    name: "Project Alpha",
    parentId: "root",
  });
  transaction.objectStore(TAGS_STORE).put({
    id: "important",
    name: "Important",
    normalizedName: "important",
  });
  transaction
    .objectStore(BOOKMARKS_STORE)
    .put(bookmark("100", "2026-01-01T00:00:00.000Z"));
  transaction
    .objectStore(BOOKMARKS_STORE)
    .put(bookmark("200", "2026-02-01T00:00:00.000Z"));
  await transactionDone(transaction);
}

describe("SearchRepository", () => {
  it("exposes the same enriched local corpus for semantic indexing", async () => {
    const databaseName = `search-corpus-${crypto.randomUUID()}`;
    await seed(databaseName);
    const repository = new SearchRepository(databaseName);

    const documents = await repository.listDocuments();
    expect(
      documents.map(({ bookmark: stored, tagNames, folderBreadcrumb }) => ({
        id: stored.id,
        tagNames,
        folderBreadcrumb,
      })),
    ).toEqual([
      {
        id: "100",
        tagNames: ["Important"],
        folderBreadcrumb: ["Research", "Project Alpha"],
      },
      {
        id: "200",
        tagNames: ["Important"],
        folderBreadcrumb: ["Research", "Project Alpha"],
      },
    ]);
  });

  it("searches tag names and complete folder breadcrumbs with explicit pagination", async () => {
    const databaseName = `search-${crypto.randomUUID()}`;
    await seed(databaseName);
    const repository = new SearchRepository(databaseName);

    const first = await repository.search({
      query: "research alpha important",
      view: "current",
      limit: 1,
    });
    expect(first.items.map(({ id }) => id)).toEqual(["200"]);
    expect(first.total).toBe(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    if (first.nextCursor === null) throw new Error("Expected a second page.");

    const second = await repository.search({
      query: "research alpha important",
      view: "current",
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(second).toEqual({
      items: [bookmark("100", "2026-01-01T00:00:00.000Z")],
      total: 2,
      nextCursor: null,
    });
  });

  it("reuses its in-memory corpus until mutations explicitly invalidate it", async () => {
    const databaseName = `search-cache-${crypto.randomUUID()}`;
    await seed(databaseName);
    const repository = new SearchRepository(databaseName);
    await expect(
      repository.search({ query: "brand new", view: "current", limit: 10 }),
    ).resolves.toMatchObject({ total: 0 });

    const database = await new BookmarkDatabase(databaseName).open();
    const transaction = database.transaction(BOOKMARKS_STORE, "readwrite");
    transaction.objectStore(BOOKMARKS_STORE).put({
      ...bookmark("300", "2026-03-01T00:00:00.000Z"),
      text: "Brand new bookmark",
    });
    await transactionDone(transaction);

    await expect(
      repository.search({ query: "brand new", view: "current", limit: 10 }),
    ).resolves.toMatchObject({ total: 0 });
    repository.invalidate();
    await expect(
      repository.search({ query: "brand new", view: "current", limit: 10 }),
    ).resolves.toMatchObject({
      items: [
        {
          id: "300",
          text: "Brand new bookmark",
        },
      ],
      total: 1,
    });
  });

  it("loads 1,000+ bookmarks once instead of scanning IndexedDB per query", async () => {
    const databaseName = `search-large-${crypto.randomUUID()}`;
    const database = await new BookmarkDatabase(databaseName).open();
    const transaction = database.transaction(BOOKMARKS_STORE, "readwrite");
    const store = transaction.objectStore(BOOKMARKS_STORE);
    for (let index = 0; index < 1_250; index += 1) {
      store.put({
        ...bookmark(String(index), "2026-01-01T00:00:00.000Z"),
        text: `Local search topic ${index}`,
        folderId: null,
        tagIds: [],
      });
    }
    await transactionDone(transaction);
    const getAll = vi.spyOn(IDBObjectStore.prototype, "getAll");
    const repository = new SearchRepository(databaseName);

    for (const query of ["topic 1", "topic 2", "topic 3", "topic 12"]) {
      await repository.search({ query, view: "current", limit: 50 });
    }

    expect(getAll).toHaveBeenCalledTimes(3);
    getAll.mockRestore();
  }, 15_000);
});
