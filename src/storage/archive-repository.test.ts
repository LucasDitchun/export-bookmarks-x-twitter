import { describe, expect, it } from "vitest";

import { ArchiveRepository } from "./archive-repository";
import { BookmarkDatabase, transactionDone } from "./bookmark-database";
import type { BookmarkRecord, BookmarkSnapshot } from "../domain/types";

const syncedBookmark: BookmarkSnapshot = {
  id: "post-1",
  text: "Original text",
  url: "https://x.com/author/status/post-1",
  author: { id: "author-1", username: "author", name: "Author" },
  postCreatedAt: "2025-01-01T00:00:00.000Z",
  media: {
    images: ["https://pbs.twimg.com/media/original?format=jpg&name=large"],
    videos: [],
  },
};

async function putRecord(databaseName: string, record: BookmarkRecord): Promise<void> {
  const database = await new BookmarkDatabase(databaseName).open();
  const transaction = database.transaction("bookmarks", "readwrite");
  transaction.objectStore("bookmarks").put(record);
  await transactionDone(transaction);
  database.close();
}

describe("ArchiveRepository", () => {
  it("adds, archives, and rebookmarks live posts without losing local metadata", async () => {
    const databaseName = `live-${crypto.randomUUID()}`;
    const repository = new ArchiveRepository(databaseName);

    await expect(
      repository.applyLiveBookmark(syncedBookmark, "save", "2026-08-09T09:00:00.000Z"),
    ).resolves.toMatchObject({ status: "current", note: "", tagIds: [] });

    const database = await new BookmarkDatabase(databaseName).open();
    const transaction = database.transaction("bookmarks", "readwrite");
    const current = await new Promise<BookmarkRecord>((resolve, reject) => {
      const request = transaction
        .objectStore("bookmarks")
        .get(syncedBookmark.id) as IDBRequest<BookmarkRecord | undefined>;
      request.onsuccess = () => {
        if (request.result) resolve(request.result);
        else reject(new Error("Seeded live bookmark was not found."));
      };
      request.onerror = () =>
        reject(request.error ?? new Error("Live bookmark lookup failed."));
    });
    transaction.objectStore("bookmarks").put({
      ...current,
      note: "Why this matters",
      folderId: "folder-research",
      tagIds: ["tag-ai"],
      metadataUpdatedAt: "2026-08-09T09:02:00.000Z",
    });
    await transactionDone(transaction);
    database.close();

    await expect(
      repository.applyLiveBookmark(
        syncedBookmark,
        "remove",
        "2026-08-09T09:03:00.000Z",
      ),
    ).resolves.toMatchObject({
      status: "archived",
      archivedAt: "2026-08-09T09:03:00.000Z",
      lastSeenAt: "2026-08-09T09:03:00.000Z",
    });
    await expect(
      repository.applyLiveBookmark(
        { ...syncedBookmark, text: "Edited on X" },
        "save",
        "2026-08-09T09:04:00.000Z",
      ),
    ).resolves.toMatchObject({
      status: "current",
      archivedAt: null,
      text: "Edited on X",
      note: "Why this matters",
      folderId: "folder-research",
      tagIds: ["tag-ai"],
      firstSavedAt: "2026-08-09T09:00:00.000Z",
      metadataUpdatedAt: "2026-08-09T09:02:00.000Z",
      media: {
        images: ["https://pbs.twimg.com/media/original?format=jpg&name=large"],
        videos: [],
      },
    });
  });

  it("does not create a local record when an unknown post is unbookmarked", async () => {
    const repository = new ArchiveRepository(`live-missing-${crypto.randomUUID()}`);

    await expect(
      repository.applyLiveBookmark(
        syncedBookmark,
        "remove",
        "2026-08-09T09:03:00.000Z",
      ),
    ).resolves.toBeNull();
    await expect(repository.getAll()).resolves.toEqual([]);
  });

  it("adds scraped bookmarks as current records with empty local metadata", async () => {
    const repository = new ArchiveRepository(`test-${crypto.randomUUID()}`);

    await expect(
      repository.mergeBookmarks(
        [syncedBookmark],
        "capture-1",
        "2026-01-01T00:00:00.000Z",
      ),
    ).resolves.toEqual({ added: 1, updated: 0 });

    await expect(repository.getAll()).resolves.toEqual([
      {
        ...syncedBookmark,
        note: "",
        folderId: null,
        folders: [],
        tagIds: [],
        firstSavedAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-01-01T00:00:00.000Z",
        archivedAt: null,
        metadataUpdatedAt: "2026-01-01T00:00:00.000Z",
        status: "current",
      },
    ]);
  });

  it("refreshes scrape fields while preserving local metadata and firstSavedAt", async () => {
    const databaseName = `test-${crypto.randomUUID()}`;
    const repository = new ArchiveRepository(databaseName);
    const existing: BookmarkRecord = {
      ...syncedBookmark,
      media: syncedBookmark.media ?? { images: [], videos: [] },
      note: "Read this later",
      folderId: "folder-1",
      tagIds: ["tag-1"],
      firstSavedAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      archivedAt: "2026-01-15T00:00:00.000Z",
      metadataUpdatedAt: "2026-01-10T00:00:00.000Z",
      status: "archived",
    };
    await putRecord(databaseName, existing);

    await expect(
      repository.mergeBookmarks(
        [{ ...syncedBookmark, text: "Edited text" }],
        "capture-2",
        "2026-02-01T00:00:00.000Z",
      ),
    ).resolves.toEqual({ added: 0, updated: 1 });

    await expect(repository.getAll()).resolves.toEqual([
      {
        ...existing,
        text: "Edited text",
        folders: [],
        lastSeenAt: "2026-02-01T00:00:00.000Z",
        archivedAt: null,
        status: "current",
      },
    ]);
  });

  it("hydrates every normalized folder membership for export", async () => {
    const databaseName = `folders-${crypto.randomUUID()}`;
    const existing: BookmarkRecord = {
      ...syncedBookmark,
      media: syncedBookmark.media ?? { images: [], videos: [] },
      note: "",
      folderId: "folder-1",
      tagIds: [],
      firstSavedAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      archivedAt: null,
      metadataUpdatedAt: "2026-01-01T00:00:00.000Z",
      status: "current",
    };
    const database = await new BookmarkDatabase(databaseName).open();
    const transaction = database.transaction(
      ["bookmarkFolders", "bookmarks", "folders"],
      "readwrite",
    );
    transaction.objectStore("bookmarks").put(existing);
    transaction.objectStore("folders").put({ id: "folder-1", name: "Research" });
    transaction.objectStore("folders").put({ id: "folder-2", name: "Reading list" });
    transaction
      .objectStore("bookmarkFolders")
      .put({ bookmarkId: "post-1", folderId: "folder-1" });
    transaction
      .objectStore("bookmarkFolders")
      .put({ bookmarkId: "post-1", folderId: "folder-2" });
    await transactionDone(transaction);
    database.close();

    await expect(new ArchiveRepository(databaseName).getAll()).resolves.toEqual([
      {
        ...existing,
        folders: [
          { id: "folder-1", name: "Research" },
          { id: "folder-2", name: "Reading list" },
        ],
      },
    ]);
  });

  it("archives missing current records once without rewriting archivedAt", async () => {
    const repository = new ArchiveRepository(`test-${crypto.randomUUID()}`);
    await repository.mergeBookmarks(
      [syncedBookmark],
      "capture-1",
      "2026-01-01T00:00:00.000Z",
    );
    await repository.finalizeCapture("capture-1", "2026-01-01T00:05:00.000Z");

    await repository.finalizeCapture("capture-2", "2026-02-01T00:05:00.000Z");
    await repository.finalizeCapture("capture-3", "2026-03-01T00:05:00.000Z");

    await expect(repository.getAll()).resolves.toEqual([
      expect.objectContaining({
        id: "post-1",
        status: "archived",
        archivedAt: "2026-02-01T00:05:00.000Z",
      }),
    ]);
    await expect(repository.getStats()).resolves.toEqual({
      total: 1,
      current: 0,
      archived: 1,
      lastSuccessfulSyncAt: "2026-03-01T00:05:00.000Z",
    });
  });

  it("does not archive unseen records until a capture is finalized", async () => {
    const repository = new ArchiveRepository(`test-${crypto.randomUUID()}`);
    await repository.mergeBookmarks(
      [syncedBookmark],
      "capture-1",
      "2026-01-01T00:00:00.000Z",
    );
    await repository.finalizeCapture("capture-1", "2026-01-01T00:01:00.000Z");

    await repository.mergeBookmarks(
      [{ ...syncedBookmark, id: "post-2" }],
      "capture-cancelled",
      "2026-02-01T00:00:00.000Z",
    );

    expect((await repository.getAll()).find(({ id }) => id === "post-1")?.status).toBe(
      "current",
    );
    await repository.clear();
    await expect(repository.getAll()).resolves.toEqual([]);
    await expect(repository.getStats()).resolves.toEqual({
      total: 0,
      current: 0,
      archived: 0,
      lastSuccessfulSyncAt: null,
    });
  });
});
