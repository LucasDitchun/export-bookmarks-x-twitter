import { describe, expect, it } from "vitest";

import type { BookmarkRecord } from "../domain/types";
import {
  BOOKMARKS_STORE,
  BookmarkDatabase,
  FOLDERS_STORE,
  TAGS_STORE,
  transactionDone,
} from "./bookmark-database";
import { ExportRepository } from "./export-repository";

const bookmark: BookmarkRecord = {
  id: "123",
  text: "Saved post",
  url: "https://x.com/person/status/123",
  author: { id: "person", username: "person", name: "Person" },
  postCreatedAt: "2026-08-01T00:00:00.000Z",
  media: { images: [], videos: [] },
  note: "Remember this",
  folderId: "child",
  tagIds: ["tag"],
  firstSavedAt: "2026-08-02T00:00:00.000Z",
  lastSeenAt: "2026-08-03T00:00:00.000Z",
  archivedAt: null,
  metadataUpdatedAt: "2026-08-03T00:00:00.000Z",
  status: "current",
};

describe("ExportRepository", () => {
  it("reads bookmarks, the complete folder tree, and tags in one snapshot", async () => {
    const databaseName = `export-${crypto.randomUUID()}`;
    const database = await new BookmarkDatabase(databaseName).open();
    const transaction = database.transaction(
      [BOOKMARKS_STORE, FOLDERS_STORE, TAGS_STORE],
      "readwrite",
    );
    transaction.objectStore(BOOKMARKS_STORE).put(bookmark);
    transaction
      .objectStore(FOLDERS_STORE)
      .put({ id: "root", name: "Work", parentId: null });
    transaction
      .objectStore(FOLDERS_STORE)
      .put({ id: "child", name: "Reading", parentId: "root" });
    transaction.objectStore(TAGS_STORE).put({
      id: "tag",
      name: "Research",
      normalizedName: "research",
    });
    transaction.objectStore(FOLDERS_STORE).put({
      id: "deleted-folder",
      name: "Old folder",
      parentId: null,
      deletedAt: "2026-08-04T00:00:00.000Z",
    });
    transaction.objectStore(TAGS_STORE).put({
      id: "deleted-tag",
      name: "Old tag",
      normalizedName: "old tag",
      deletedAt: "2026-08-04T00:00:00.000Z",
    });
    await transactionDone(transaction);
    database.close();

    await expect(new ExportRepository(databaseName).snapshot()).resolves.toEqual({
      bookmarks: [bookmark],
      folders: [
        { id: "root", name: "Work", parentId: null },
        { id: "child", name: "Reading", parentId: "root" },
      ],
      tags: [{ id: "tag", name: "Research", normalizedName: "research" }],
    });
  });
});
