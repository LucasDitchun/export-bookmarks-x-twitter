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
  it("creates the complete version 2 schema for a new database", async () => {
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
      note: "",
      folderId: "folder-1",
      tagIds: [],
      firstSavedAt: "2026-01-02T00:00:00.000Z",
      lastSeenAt: "2026-02-03T00:00:00.000Z",
      archivedAt: "2026-02-03T00:00:00.000Z",
      metadataUpdatedAt: "2026-01-02T00:00:00.000Z",
      status: "archived",
    });
    expect(migratedFolder).toEqual({ id: "folder-1", name: "Research" });
    expect(secondMigratedFolder).toEqual({
      id: "folder-2",
      name: "Reading list",
    });
    expect(migratedMemberships).toEqual([
      { bookmarkId: "post-1", folderId: "folder-1" },
      { bookmarkId: "post-1", folderId: "folder-2" },
    ]);

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

    await expect(opening).resolves.toMatchObject({ version: 2 });
    await connection.close();
  });

  it("closes its connection on versionchange so another upgrade can proceed", async () => {
    const databaseName = `versionchange-${crypto.randomUUID()}`;
    const connection = new BookmarkDatabase(databaseName);
    await connection.open();

    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 3);
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

    expect(upgraded.version).toBe(3);
    upgraded.close();
  });

  it("allows retry after a rejected open request", async () => {
    const databaseName = `retry-${crypto.randomUUID()}`;
    const futureDatabase = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, 3);
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

    await expect(connection.open()).resolves.toMatchObject({ version: 2 });
    await connection.close();
  });
});
