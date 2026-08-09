import { describe, expect, it, vi } from "vitest";

import { BACKUP_SCHEMA_VERSION, parseBackup } from "../domain/backup";
import type { BookmarkRecord } from "../domain/types";
import { GITHUB_CACHE_KEY } from "../github/github-project";
import {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  SETTINGS_STORAGE_KEY,
  SettingsRepository,
  type ExtensionSettings,
} from "../settings/settings-repository";
import { BookmarkRepository } from "./bookmark-repository";
import {
  BookmarkDatabase,
  requestAsPromise,
  transactionDone,
} from "./bookmark-database";
import {
  BackupRepository,
  BackupSettingsWriteError,
  type BackupStorageArea,
} from "./backup-repository";

class MemoryStorage implements BackupStorageArea {
  values: Record<string, unknown> = {};
  failSet = false;
  setCalls = 0;
  getDelayMs = 0;

  async get(keys: string | string[]): Promise<Record<string, unknown>> {
    if (this.getDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.getDelayMs));
    }
    const selected = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(
      selected
        .filter((key) => key in this.values)
        .map((key) => [key, this.values[key]]),
    );
  }

  async set(items: Record<string, unknown>): Promise<void> {
    this.setCalls += 1;
    if (this.failSet) throw new Error("storage unavailable");
    Object.assign(this.values, items);
  }
}

const backedUpSettings: ExtensionSettings = {
  ...structuredClone(DEFAULT_SETTINGS),
  behavior: {
    ...structuredClone(DEFAULT_SETTINGS.behavior),
    surface: "sidePanel",
    metadata: {
      ...structuredClone(DEFAULT_SETTINGS.behavior.metadata),
      note: false,
    },
  },
  export: {
    ...structuredClone(DEFAULT_SETTINGS.export),
    includeVideos: false,
  },
};

function repository(
  databaseName: string,
  storage: MemoryStorage,
  options: {
    now?: () => Date;
    onDataRestored?: () => void;
  } = {},
): BackupRepository {
  return new BackupRepository(databaseName, {
    storage,
    settings: new SettingsRepository(storage),
    ...options,
  });
}

const bookmark: BookmarkRecord = {
  id: "123",
  text: "Saved post",
  url: "https://x.com/person/status/123",
  author: { id: "456", username: "person", name: "Person" },
  postCreatedAt: "2026-07-01T10:00:00.000Z",
  media: {
    images: ["https://pbs.twimg.com/media/backup?format=jpg&name=large"],
    videos: [
      {
        thumbnailUrl: "https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/thumb.jpg",
        postUrl: "https://x.com/person/status/123",
      },
    ],
  },
  note: "Important",
  folderId: "folder-ai",
  tagIds: ["tag-research"],
  firstSavedAt: "2026-07-02T10:00:00.000Z",
  lastSeenAt: "2026-07-03T10:00:00.000Z",
  archivedAt: null,
  metadataUpdatedAt: "2026-07-04T10:00:00.000Z",
  status: "current",
};

async function seed(
  databaseName: string,
  options: {
    bookmark?: BookmarkRecord;
    lastSuccessfulSyncAt?: string;
    ephemeral?: boolean;
  } = {},
): Promise<void> {
  const database = await new BookmarkDatabase(databaseName).open();
  const transaction = database.transaction(
    ["bookmarks", "folders", "tags", "bookmarkFolders", "meta", "seen"],
    "readwrite",
  );
  const value = options.bookmark ?? bookmark;
  transaction.objectStore("bookmarks").put(value);
  transaction
    .objectStore("folders")
    .put({ id: "folder-root", name: "Reading", parentId: null });
  transaction
    .objectStore("folders")
    .put({ id: "folder-ai", name: "AI", parentId: "folder-root" });
  transaction.objectStore("tags").put({
    id: "tag-research",
    name: "Research",
    normalizedName: "research",
  });
  if (value.folderId !== null) {
    transaction
      .objectStore("bookmarkFolders")
      .put({ bookmarkId: value.id, folderId: value.folderId });
  }
  if (options.lastSuccessfulSyncAt) {
    transaction.objectStore("meta").put({
      key: "lastSuccessfulSyncAt",
      value: options.lastSuccessfulSyncAt,
    });
  }
  if (options.ephemeral) {
    transaction.objectStore("seen").put({
      key: "run:123",
      runId: "run",
      bookmarkId: "123",
    });
    transaction.objectStore("meta").put({ key: "checkpoint", value: "private" });
  }
  await transactionDone(transaction);
  database.close();
}

async function allFromStore<T>(databaseName: string, storeName: string): Promise<T[]> {
  const database = await new BookmarkDatabase(databaseName).open();
  const transaction = database.transaction(storeName, "readonly");
  const values = await requestAsPromise(
    transaction.objectStore(storeName).getAll() as IDBRequest<T[]>,
  );
  await transactionDone(transaction);
  database.close();
  return values;
}

describe("BackupRepository", () => {
  it("exports all logical user data and excludes implementation checkpoints", async () => {
    const databaseName = `backup-export-${crypto.randomUUID()}`;
    const storage = new MemoryStorage();
    storage.values.uiLocale = "fr";
    storage.values[SETTINGS_STORAGE_KEY] = {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      settings: backedUpSettings,
    };
    storage.values.scrapeRun = { id: "must-not-export" };
    storage.values[GITHUB_CACHE_KEY] = {
      stars: 999,
      fetchedAt: Date.UTC(2026, 7, 9),
    };
    storage.getDelayMs = 10;
    await seed(databaseName, {
      lastSuccessfulSyncAt: "2026-07-03T10:05:00.000Z",
      ephemeral: true,
    });

    const result = await repository(databaseName, storage, {
      now: () => new Date("2026-08-09T08:00:00.000Z"),
    }).export();
    const exported = parseBackup(result.content);

    expect(result.filename).toBe("bookmark-x-backup-2026-08-09T08-00-00Z.json");
    expect(exported).toEqual({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: "2026-08-09T08:00:00.000Z",
      data: {
        bookmarks: [bookmark],
        folders: [
          { id: "folder-ai", name: "AI", parentId: "folder-root" },
          { id: "folder-root", name: "Reading", parentId: null },
        ],
        tags: [{ id: "tag-research", name: "Research", normalizedName: "research" }],
        archive: { lastSuccessfulSyncAt: "2026-07-03T10:05:00.000Z" },
        settings: {
          uiLocale: "fr",
          extension: {
            schemaVersion: SETTINGS_SCHEMA_VERSION,
            settings: backedUpSettings,
          },
        },
      },
    });
    expect(result.content).not.toContain("must-not-export");
    expect(result.content).not.toContain("checkpoint");
    expect(result.content).not.toContain("bookmarkFolders");
    expect(result.content).not.toContain(GITHUB_CACHE_KEY);
  });

  it("replaces IDB user data atomically and rebuilds hydration indexes", async () => {
    const sourceName = `backup-source-${crypto.randomUUID()}`;
    const targetName = `backup-target-${crypto.randomUUID()}`;
    const sourceStorage = new MemoryStorage();
    sourceStorage.values.uiLocale = "ja";
    sourceStorage.values[SETTINGS_STORAGE_KEY] = {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      settings: backedUpSettings,
    };
    await seed(sourceName, { lastSuccessfulSyncAt: "2026-07-03T10:05:00.000Z" });
    const content = (await repository(sourceName, sourceStorage).export()).content;
    const oldBookmark: BookmarkRecord = {
      ...bookmark,
      id: "999",
      url: "https://x.com/person/status/999",
      folderId: null,
      tagIds: [],
      media: { images: [], videos: [] },
    };
    await seed(targetName, { bookmark: oldBookmark, ephemeral: true });
    const targetStorage = new MemoryStorage();
    targetStorage.values.uiLocale = "de";
    targetStorage.values[GITHUB_CACHE_KEY] = {
      stars: 123,
      fetchedAt: Date.UTC(2026, 7, 9),
    };
    const onDataRestored = vi.fn();

    const restored = await repository(targetName, targetStorage, {
      onDataRestored,
    }).restore(content, "replace");

    expect(restored).toEqual({
      bookmarks: 1,
      folders: 2,
      tags: 1,
      mode: "replace",
      reloadRequired: true,
    });
    expect(onDataRestored).toHaveBeenCalledOnce();
    expect(await allFromStore<BookmarkRecord>(targetName, "bookmarks")).toEqual([
      bookmark,
    ]);
    expect(await allFromStore(targetName, "seen")).toEqual([]);
    expect(await allFromStore(targetName, "meta")).toEqual([
      { key: "lastSuccessfulSyncAt", value: "2026-07-03T10:05:00.000Z" },
    ]);
    expect(targetStorage.values.uiLocale).toBe("ja");
    expect(targetStorage.values[SETTINGS_STORAGE_KEY]).toEqual({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      settings: backedUpSettings,
    });
    expect(targetStorage.values[GITHUB_CACHE_KEY]).toEqual({
      stars: 123,
      fetchedAt: Date.UTC(2026, 7, 9),
    });

    const page = await new BookmarkRepository(targetName).list({
      view: "current",
      limit: 50,
    });
    expect(page.items).toEqual([bookmark]);
    expect(await allFromStore(targetName, "bookmarkFolders")).toEqual([
      { bookmarkId: "123", folderId: "folder-ai" },
    ]);
  });

  it("merges with backup records winning conflicts and preserves local-only data", async () => {
    const sourceName = `backup-merge-source-${crypto.randomUUID()}`;
    const targetName = `backup-merge-target-${crypto.randomUUID()}`;
    const storage = new MemoryStorage();
    await seed(sourceName);
    const content = (await repository(sourceName, storage).export()).content;
    const conflicting = { ...bookmark, note: "Old local note" };
    await seed(targetName, { bookmark: conflicting });
    const database = await new BookmarkDatabase(targetName).open();
    const transaction = database.transaction("bookmarks", "readwrite");
    transaction.objectStore("bookmarks").put({
      ...bookmark,
      id: "777",
      url: "https://x.com/person/status/777",
      note: "Local only",
      folderId: null,
      tagIds: [],
      media: { images: [], videos: [] },
    });
    await transactionDone(transaction);
    database.close();

    await repository(targetName, storage).restore(content, "merge");

    expect(await allFromStore<BookmarkRecord>(targetName, "bookmarks")).toEqual([
      bookmark,
      expect.objectContaining({ id: "777", note: "Local only" }),
    ]);
  });

  it("resolves a local semantic tag duplicate to the backup tag ID", async () => {
    const sourceName = `backup-tag-source-${crypto.randomUUID()}`;
    const targetName = `backup-tag-target-${crypto.randomUUID()}`;
    const storage = new MemoryStorage();
    await seed(sourceName);
    const content = (await repository(sourceName, storage).export()).content;
    await seed(targetName, {
      bookmark: {
        ...bookmark,
        id: "777",
        url: "https://x.com/person/status/777",
        folderId: null,
        tagIds: ["tag-local"],
        media: { images: [], videos: [] },
      },
    });
    const database = await new BookmarkDatabase(targetName).open();
    const transaction = database.transaction(["tags", "bookmarks"], "readwrite");
    transaction.objectStore("tags").delete("tag-research");
    transaction.objectStore("tags").put({
      id: "tag-local",
      name: "Ｒｅｓｅａｒｃｈ",
      normalizedName: "research",
    });
    await transactionDone(transaction);
    database.close();

    await repository(targetName, storage).restore(content, "merge");

    expect(await allFromStore(targetName, "tags")).toEqual([
      { id: "tag-research", name: "Research", normalizedName: "research" },
    ]);
    expect(await allFromStore<BookmarkRecord>(targetName, "bookmarks")).toContainEqual(
      expect.objectContaining({ id: "777", tagIds: ["tag-research"] }),
    );
  });

  it("validates the entire graph before any database or settings write", async () => {
    const databaseName = `backup-invalid-${crypto.randomUUID()}`;
    const storage = new MemoryStorage();
    storage.values.uiLocale = "it";
    await seed(databaseName);
    const before = await allFromStore<BookmarkRecord>(databaseName, "bookmarks");

    await expect(
      repository(databaseName, storage).restore(
        '{"schemaVersion":1,"exportedAt":"invalid"}',
        "replace",
      ),
    ).rejects.toThrow(/invalid backup file/i);

    expect(await allFromStore<BookmarkRecord>(databaseName, "bookmarks")).toEqual(
      before,
    );
    expect(storage.setCalls).toBe(0);
    expect(storage.values.uiLocale).toBe("it");
  });

  it("reports a deterministic partial result when settings fail after IDB commits", async () => {
    const sourceName = `backup-settings-source-${crypto.randomUUID()}`;
    const targetName = `backup-settings-target-${crypto.randomUUID()}`;
    const sourceStorage = new MemoryStorage();
    await seed(sourceName);
    const content = (await repository(sourceName, sourceStorage).export()).content;
    const targetStorage = new MemoryStorage();
    targetStorage.failSet = true;

    await expect(
      repository(targetName, targetStorage).restore(content, "replace"),
    ).rejects.toBeInstanceOf(BackupSettingsWriteError);
    expect(await allFromStore<BookmarkRecord>(targetName, "bookmarks")).toEqual([
      bookmark,
    ]);
  });

  it("aborts IDB and never writes settings when the database write fails", async () => {
    const sourceName = `backup-idb-source-${crypto.randomUUID()}`;
    const targetName = `backup-idb-target-${crypto.randomUUID()}`;
    const sourceStorage = new MemoryStorage();
    await seed(sourceName);
    const content = (await repository(sourceName, sourceStorage).export()).content;
    const targetStorage = new MemoryStorage();
    targetStorage.values.uiLocale = "de";
    const oldBookmark = {
      ...bookmark,
      id: "999",
      url: "https://x.com/person/status/999",
      note: "Must survive",
    };
    await seed(targetName, { bookmark: oldBookmark });
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new DOMException("simulated", "DataError");
    });

    try {
      await expect(
        repository(targetName, targetStorage).restore(content, "replace"),
      ).rejects.toThrow("simulated");
    } finally {
      put.mockRestore();
    }

    expect(await allFromStore<BookmarkRecord>(targetName, "bookmarks")).toEqual([
      oldBookmark,
    ]);
    expect(targetStorage.setCalls).toBe(0);
    expect(targetStorage.values.uiLocale).toBe("de");
  });
});
