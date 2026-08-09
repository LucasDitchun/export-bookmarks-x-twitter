import { describe, expect, it, vi } from "vitest";

import { BOOKMARK_DATABASE_VERSION, BookmarkDatabase } from "./bookmark-database";

function indexedDbError(error: DOMException | null): Error {
  return error ?? new Error("IndexedDB test request failed.");
}

function openVersionOne(databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.addEventListener("upgradeneeded", () => {
      request.result.createObjectStore("bookmarks", { keyPath: "id" });
      const seen = request.result.createObjectStore("seen", { keyPath: "key" });
      seen.createIndex("runId", "runId", { unique: false });
      request.result.createObjectStore("meta", { keyPath: "key" });
    });
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener("error", () => reject(indexedDbError(request.error)), {
      once: true,
    });
  });
}

function openVersionTwo(
  databaseName: string,
  version: 2 | 3 = 2,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, version);
    request.addEventListener("upgradeneeded", () => {
      const bookmarks = request.result.createObjectStore("bookmarks", {
        keyPath: "id",
      });
      bookmarks.createIndex("byStatusSaved", ["status", "firstSavedAt", "id"]);
      bookmarks.createIndex("byFolder", "folderId");
      bookmarks.createIndex("byTag", "tagIds", { multiEntry: true });
      const seen = request.result.createObjectStore("seen", { keyPath: "key" });
      seen.createIndex("runId", "runId");
      request.result.createObjectStore("meta", { keyPath: "key" });
      const folders = request.result.createObjectStore("folders", { keyPath: "id" });
      folders.createIndex("byName", "name");
      const memberships = request.result.createObjectStore("bookmarkFolders", {
        keyPath: ["bookmarkId", "folderId"],
      });
      memberships.createIndex("byBookmark", "bookmarkId");
      memberships.createIndex("byFolder", "folderId");
      const tags = request.result.createObjectStore("tags", { keyPath: "id" });
      tags.createIndex("byName", "name");
    });
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener("error", () => reject(indexedDbError(request.error)), {
      once: true,
    });
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(indexedDbError(transaction.error)),
      {
        once: true,
      },
    );
  });
}

describe("BookmarkDatabase", () => {
  it("creates the complete version 4 schema for a new database", async () => {
    const database = await new BookmarkDatabase(
      `fresh-v2-${crypto.randomUUID()}`,
    ).open();

    expect(database.version).toBe(BOOKMARK_DATABASE_VERSION);
    expect(Array.from(database.objectStoreNames)).toEqual([
      "bookmarkFolders",
      "bookmarks",
      "folders",
      "meta",
      "seen",
      "tags",
    ]);

    const transaction = database.transaction(
      ["bookmarkFolders", "bookmarks", "folders", "tags"],
      "readonly",
    );
    expect(Array.from(transaction.objectStore("bookmarkFolders").indexNames)).toEqual([
      "byBookmark",
      "byFolder",
    ]);
    expect(Array.from(transaction.objectStore("bookmarks").indexNames)).toEqual([
      "byFolder",
      "byStatusSaved",
      "byTag",
    ]);
    expect(Array.from(transaction.objectStore("folders").indexNames)).toEqual([
      "byName",
      "byParent",
    ]);
    expect(Array.from(transaction.objectStore("tags").indexNames)).toEqual(["byName"]);
    await transactionDone(transaction);

    database.close();
  });

  it("atomically migrates real version 1 records without losing timestamps", async () => {
    const databaseName = `migrate-v1-${crypto.randomUUID()}`;
    const versionOne = await openVersionOne(databaseName);
    const legacyRecord = {
      id: "post-1",
      text: "Legacy post",
      url: "https://x.com/author/status/post-1",
      author: { id: "author-1", username: "author", name: "Author" },
      postCreatedAt: "2025-01-01T00:00:00.000Z",
      folders: [
        { id: "folder-1", name: "Research" },
        { id: "folder-2", name: "Reading list" },
      ],
      firstArchivedAt: "2026-01-02T00:00:00.000Z",
      lastSeenAt: "2026-02-03T00:00:00.000Z",
      isCurrent: false,
    };
    const seed = versionOne.transaction("bookmarks", "readwrite");
    seed.objectStore("bookmarks").put(legacyRecord);
    await transactionDone(seed);
    versionOne.close();

    const database = await new BookmarkDatabase(databaseName).open();
    const transaction = database.transaction(
      ["bookmarkFolders", "bookmarks", "folders"],
      "readonly",
    );
    const request = transaction.objectStore("bookmarks").get("post-1");
    const folderRequest = transaction.objectStore("folders").get("folder-1");
    const secondFolderRequest = transaction.objectStore("folders").get("folder-2");
    const membershipsRequest = transaction.objectStore("bookmarkFolders").getAll();
    const migrated = await new Promise<Record<string, unknown> | undefined>(
      (resolve, reject) => {
        request.addEventListener(
          "success",
          () => resolve(request.result as Record<string, unknown> | undefined),
          { once: true },
        );
        request.addEventListener("error", () => reject(indexedDbError(request.error)), {
          once: true,
        });
      },
    );
    const migratedFolder = await new Promise<Record<string, unknown> | undefined>(
      (resolve, reject) => {
        folderRequest.addEventListener(
          "success",
          () => resolve(folderRequest.result as Record<string, unknown> | undefined),
          { once: true },
        );
        folderRequest.addEventListener(
          "error",
          () => reject(indexedDbError(folderRequest.error)),
          { once: true },
        );
      },
    );
    const secondMigratedFolder = await new Promise<Record<string, unknown> | undefined>(
      (resolve, reject) => {
        secondFolderRequest.addEventListener(
          "success",
          () =>
            resolve(secondFolderRequest.result as Record<string, unknown> | undefined),
          { once: true },
        );
        secondFolderRequest.addEventListener(
          "error",
          () => reject(indexedDbError(secondFolderRequest.error)),
          { once: true },
        );
      },
    );
    const migratedMemberships = await new Promise<Record<string, unknown>[]>(
      (resolve, reject) => {
        membershipsRequest.addEventListener(
          "success",
          () => resolve(membershipsRequest.result as Record<string, unknown>[]),
          { once: true },
        );
        membershipsRequest.addEventListener(
          "error",
          () => reject(indexedDbError(membershipsRequest.error)),
          { once: true },
        );
      },
    );
    await transactionDone(transaction);

    expect(migrated).toEqual({
      id: "post-1",
      text: "Legacy post",
      url: "https://x.com/author/status/post-1",
      author: { id: "author-1", username: "author", name: "Author" },
      postCreatedAt: "2025-01-01T00:00:00.000Z",
      media: { images: [], videos: [] },
      note: "",
      folderId: "folder-1",
      tagIds: [],
      firstSavedAt: "2026-01-02T00:00:00.000Z",
      lastSeenAt: "2026-02-03T00:00:00.000Z",
      archivedAt: "2026-02-03T00:00:00.000Z",
      metadataUpdatedAt: "2026-01-02T00:00:00.000Z",
      status: "archived",
    });
    expect(migratedFolder).toEqual({
      id: "folder-1",
      name: "Research",
      parentId: null,
    });
    expect(secondMigratedFolder).toEqual({
      id: "folder-2",
      name: "Reading list",
      parentId: null,
    });
    expect(migratedMemberships).toEqual([
      { bookmarkId: "post-1", folderId: "folder-1" },
    ]);

    database.close();
  });

  it("migrates more than five hundred version 1 bookmarks without loss or duplication", async () => {
    const databaseName = `migrate-v1-volume-${crypto.randomUUID()}`;
    const versionOne = await openVersionOne(databaseName);
    const legacyRecords = Array.from({ length: 512 }, (_, index) => {
      const id = `post-${String(index).padStart(4, "0")}`;
      const savedAt = new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString();
      return {
        id,
        text: `Legacy post ${index}`,
        url: `https://x.com/author/status/${index + 1}`,
        author: { id: "author-1", username: "author", name: "Author" },
        postCreatedAt: "2024-12-31T00:00:00.000Z",
        folders: [],
        firstArchivedAt: savedAt,
        lastSeenAt: savedAt,
        isCurrent: index % 2 === 0,
      };
    });
    const seed = versionOne.transaction("bookmarks", "readwrite");
    for (const record of legacyRecords) seed.objectStore("bookmarks").put(record);
    await transactionDone(seed);
    versionOne.close();

    const database = await new BookmarkDatabase(databaseName).open();
    const transaction = database.transaction("bookmarks", "readonly");
    const request = transaction.objectStore("bookmarks").getAll();
    const migrated = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      request.addEventListener(
        "success",
        () => resolve(request.result as Record<string, unknown>[]),
        { once: true },
      );
      request.addEventListener("error", () => reject(indexedDbError(request.error)), {
        once: true,
      });
    });
    await transactionDone(transaction);

    expect(migrated).toHaveLength(legacyRecords.length);
    expect(new Set(migrated.map(({ id }) => id)).size).toBe(legacyRecords.length);
    expect(
      migrated.map(({ id, firstSavedAt, lastSeenAt, status }) => ({
        id,
        firstSavedAt,
        lastSeenAt,
        status,
      })),
    ).toEqual(
      legacyRecords.map(({ id, firstArchivedAt, lastSeenAt, isCurrent }) => ({
        id,
        firstSavedAt: firstArchivedAt,
        lastSeenAt,
        status: isCurrent ? "current" : "archived",
      })),
    );
    expect(
      migrated.every(
        ({ note, folderId, tagIds, media }) =>
          note === "" &&
          folderId === null &&
          Array.isArray(tagIds) &&
          tagIds.length === 0 &&
          JSON.stringify(media) === '{"images":[],"videos":[]}',
      ),
    ).toBe(true);

    database.close();
  }, 15_000);

  it("normalizes version 2 folders and legacy memberships to one valid assignment", async () => {
    const databaseName = `migrate-v2-${crypto.randomUUID()}`;
    const versionTwo = await openVersionTwo(databaseName);
    const transaction = versionTwo.transaction(
      ["folders", "bookmarks", "bookmarkFolders"],
      "readwrite",
    );
    transaction.objectStore("folders").put({ id: "folder-a", name: "A" });
    transaction.objectStore("folders").put({ id: "folder-b", name: "B" });
    const base = {
      text: "Legacy post",
      url: "https://x.com/author/status/100",
      author: { id: "author", username: "author", name: "Author" },
      postCreatedAt: "2026-01-01T00:00:00.000Z",
      note: "Preserved note",
      tagIds: ["tag-1"],
      firstSavedAt: "2026-01-02T00:00:00.000Z",
      lastSeenAt: "2026-01-03T00:00:00.000Z",
      archivedAt: null,
      metadataUpdatedAt: "2026-01-04T00:00:00.000Z",
      status: "current",
    } as const;
    transaction.objectStore("bookmarks").put({
      ...base,
      id: "100",
      folderId: "folder-b",
    });
    transaction.objectStore("bookmarks").put({
      ...base,
      id: "200",
      folderId: "deleted-folder",
    });
    transaction.objectStore("bookmarkFolders").put({
      bookmarkId: "100",
      folderId: "folder-a",
    });
    transaction.objectStore("bookmarkFolders").put({
      bookmarkId: "100",
      folderId: "folder-b",
    });
    transaction.objectStore("bookmarkFolders").put({
      bookmarkId: "200",
      folderId: "folder-a",
    });
    transaction.objectStore("bookmarkFolders").put({
      bookmarkId: "200",
      folderId: "deleted-folder",
    });
    await transactionDone(transaction);
    versionTwo.close();

    const database = await new BookmarkDatabase(databaseName).open();
    const read = database.transaction(
      ["folders", "bookmarks", "bookmarkFolders"],
      "readonly",
    );
    const folders = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      const request = read.objectStore("folders").getAll();
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener("error", () => reject(indexedDbError(request.error)), {
        once: true,
      });
    });
    const bookmarks = await new Promise<Record<string, unknown>[]>(
      (resolve, reject) => {
        const request = read.objectStore("bookmarks").getAll();
        request.addEventListener("success", () => resolve(request.result), {
          once: true,
        });
        request.addEventListener("error", () => reject(indexedDbError(request.error)), {
          once: true,
        });
      },
    );
    const memberships = await new Promise<Record<string, unknown>[]>(
      (resolve, reject) => {
        const request = read.objectStore("bookmarkFolders").getAll();
        request.addEventListener("success", () => resolve(request.result), {
          once: true,
        });
        request.addEventListener("error", () => reject(indexedDbError(request.error)), {
          once: true,
        });
      },
    );
    await transactionDone(read);

    expect(folders).toEqual([
      { id: "folder-a", name: "A", parentId: null },
      { id: "folder-b", name: "B", parentId: null },
    ]);
    expect(bookmarks).toEqual([
      expect.objectContaining({
        id: "100",
        folderId: "folder-b",
        media: { images: [], videos: [] },
        note: "Preserved note",
        tagIds: ["tag-1"],
      }),
      expect.objectContaining({
        id: "200",
        folderId: "folder-a",
        media: { images: [], videos: [] },
        note: "Preserved note",
        tagIds: ["tag-1"],
      }),
    ]);
    expect(memberships).toEqual([
      { bookmarkId: "100", folderId: "folder-b" },
      { bookmarkId: "200", folderId: "folder-a" },
    ]);
    database.close();
  });

  it("adds empty media to version 3 records without changing user metadata", async () => {
    const databaseName = `migrate-v3-${crypto.randomUUID()}`;
    const versionThree = await openVersionTwo(databaseName, 3);
    const transaction = versionThree.transaction("bookmarks", "readwrite");
    transaction.objectStore("bookmarks").put({
      id: "300",
      text: "Existing post",
      url: "https://x.com/author/status/300",
      author: { id: "author", username: "author", name: "Author" },
      postCreatedAt: "2026-01-01T00:00:00.000Z",
      note: "Preserve this",
      folderId: null,
      tagIds: ["tag-1"],
      firstSavedAt: "2026-01-02T00:00:00.000Z",
      lastSeenAt: "2026-01-03T00:00:00.000Z",
      archivedAt: null,
      metadataUpdatedAt: "2026-01-04T00:00:00.000Z",
      status: "current",
    });
    await transactionDone(transaction);
    versionThree.close();

    const database = await new BookmarkDatabase(databaseName).open();
    const read = database.transaction("bookmarks", "readonly");
    const migrated = await new Promise<Record<string, unknown> | undefined>(
      (resolve, reject) => {
        const request = read.objectStore("bookmarks").get("300");
        request.addEventListener(
          "success",
          () => resolve(request.result as Record<string, unknown> | undefined),
          { once: true },
        );
        request.addEventListener("error", () => reject(indexedDbError(request.error)), {
          once: true,
        });
      },
    );
    await transactionDone(read);

    expect(migrated).toMatchObject({
      id: "300",
      note: "Preserve this",
      tagIds: ["tag-1"],
      media: { images: [], videos: [] },
    });
    database.close();
  });

  it("reports blocked upgrades and continues after the old connection closes", async () => {
    const databaseName = `blocked-${crypto.randomUUID()}`;
    const versionOne = await openVersionOne(databaseName);
    const onBlocked = vi.fn();
    let releaseBlocked!: () => void;
    const blocked = new Promise<void>((resolve) => {
      releaseBlocked = resolve;
    });
    const connection = new BookmarkDatabase(databaseName, {
      onBlocked: (event) => {
        onBlocked(event);
        releaseBlocked();
      },
    });

    const opening = connection.open();
    await blocked;
    expect(onBlocked).toHaveBeenCalledOnce();
    versionOne.close();

    await expect(opening).resolves.toMatchObject({ version: 4 });
    await connection.close();
  });

  it("closes its connection on versionchange so another upgrade can proceed", async () => {
    const databaseName = `versionchange-${crypto.randomUUID()}`;
    const connection = new BookmarkDatabase(databaseName);
    await connection.open();

    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 5);
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener("error", () => reject(indexedDbError(request.error)), {
        once: true,
      });
      request.addEventListener("blocked", () => {
        reject(new Error("Version 2 connection did not close."));
      });
    });

    expect(upgraded.version).toBe(5);
    upgraded.close();
  });

  it("allows retry after a rejected open request", async () => {
    const databaseName = `retry-${crypto.randomUUID()}`;
    const futureDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 5);
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener("error", () => reject(indexedDbError(request.error)), {
        once: true,
      });
    });
    futureDatabase.close();
    const connection = new BookmarkDatabase(databaseName);

    await expect(connection.open()).rejects.toMatchObject({ name: "VersionError" });
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName);
      request.addEventListener("success", () => resolve(), { once: true });
      request.addEventListener("error", () => reject(indexedDbError(request.error)), {
        once: true,
      });
    });

    await expect(connection.open()).resolves.toMatchObject({ version: 4 });
    await connection.close();
  });
});
