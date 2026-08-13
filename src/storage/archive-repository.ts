import type {
  ArchiveStats,
  BookmarkFolder,
  BookmarkFolderMembership,
  BookmarkRecord,
  BookmarkSnapshot,
  HydratedBookmarkRecord,
  FolderRecord,
} from "../domain/types";
import type { LiveBookmarkAction } from "../shared/protocol";
import { emptyBookmarkMedia, mergeBookmarkMedia } from "../domain/bookmark-media";
import {
  BOOKMARK_FOLDERS_STORE,
  BOOKMARKS_STORE,
  BookmarkDatabase,
  FOLDERS_STORE,
  META_STORE,
  requestAsPromise,
  SEEN_STORE,
  TAGS_STORE,
  transactionDone,
} from "./bookmark-database";

interface SeenRecord {
  key: string;
  runId: string;
  bookmarkId: string;
}

interface MetaRecord<T> {
  key: string;
  value: T;
}

export class ArchiveRepository {
  private readonly connection: BookmarkDatabase;

  constructor(databaseName = "bookmark-x") {
    this.connection = new BookmarkDatabase(databaseName);
  }

  async applyLiveBookmark(
    bookmark: BookmarkSnapshot,
    action: LiveBookmarkAction,
    changedAt: string,
  ): Promise<BookmarkRecord | null> {
    const database = await this.connection.open();
    const transaction = database.transaction(BOOKMARKS_STORE, "readwrite");
    const store = transaction.objectStore(BOOKMARKS_STORE);
    const existing = await requestAsPromise(
      store.get(bookmark.id) as IDBRequest<BookmarkRecord | undefined>,
    );

    if (action === "remove") {
      if (existing === undefined) {
        await transactionDone(transaction);
        return null;
      }
      const archived: BookmarkRecord = {
        ...existing,
        lastSeenAt: changedAt,
        archivedAt: existing.archivedAt ?? changedAt,
        status: "archived",
      };
      store.put(archived);
      await transactionDone(transaction);
      return archived;
    }

    const saved: BookmarkRecord = {
      ...bookmark,
      media: mergeBookmarkMedia(
        existing?.media ?? emptyBookmarkMedia(),
        bookmark.media ?? emptyBookmarkMedia(),
      ),
      note: existing?.note ?? "",
      folderId: existing?.folderId ?? null,
      tagIds: existing?.tagIds ?? [],
      firstSavedAt: existing?.firstSavedAt ?? changedAt,
      lastSeenAt: changedAt,
      archivedAt: null,
      metadataUpdatedAt: existing?.metadataUpdatedAt ?? changedAt,
      status: "current",
    };
    store.put(saved);
    await transactionDone(transaction);
    return saved;
  }

  async mergeBookmarks(
    bookmarks: readonly BookmarkSnapshot[],
    runId: string,
    seenAt: string,
  ): Promise<{ added: number; updated: number }> {
    const database = await this.connection.open();
    const transaction = database.transaction(
      [BOOKMARKS_STORE, SEEN_STORE],
      "readwrite",
    );
    const bookmarkStore = transaction.objectStore(BOOKMARKS_STORE);
    const seenStore = transaction.objectStore(SEEN_STORE);
    const existingRecords = await Promise.all(
      bookmarks.map((bookmark) =>
        requestAsPromise(
          bookmarkStore.get(bookmark.id) as IDBRequest<BookmarkRecord | undefined>,
        ),
      ),
    );
    let added = 0;
    let updated = 0;

    for (const [index, bookmark] of bookmarks.entries()) {
      const existing = existingRecords[index];
      const record: BookmarkRecord = {
        ...bookmark,
        media: mergeBookmarkMedia(
          existing?.media ?? emptyBookmarkMedia(),
          bookmark.media ?? emptyBookmarkMedia(),
        ),
        note: existing?.note ?? "",
        folderId: existing?.folderId ?? null,
        tagIds: existing?.tagIds ?? [],
        firstSavedAt: existing?.firstSavedAt ?? seenAt,
        lastSeenAt: seenAt,
        archivedAt: null,
        metadataUpdatedAt: existing?.metadataUpdatedAt ?? seenAt,
        status: "current",
      };
      bookmarkStore.put(record);
      const seen: SeenRecord = {
        key: `${runId}:${bookmark.id}`,
        runId,
        bookmarkId: bookmark.id,
      };
      seenStore.put(seen);
      if (existing === undefined) added += 1;
      else updated += 1;
    }

    await transactionDone(transaction);
    return { added, updated };
  }

  async finalizeCapture(
    runId: string,
    completedAt: string,
    keepArchived = true,
  ): Promise<{ archived: number; removed: number }> {
    const database = await this.connection.open();
    const transaction = database.transaction(
      [BOOKMARK_FOLDERS_STORE, BOOKMARKS_STORE, SEEN_STORE, META_STORE],
      "readwrite",
    );
    const bookmarkStore = transaction.objectStore(BOOKMARKS_STORE);
    const membershipStore = transaction.objectStore(BOOKMARK_FOLDERS_STORE);
    const seenStore = transaction.objectStore(SEEN_STORE);
    const [bookmarks, memberships, seenRecords] = await Promise.all([
      requestAsPromise(bookmarkStore.getAll() as IDBRequest<BookmarkRecord[]>),
      requestAsPromise(
        membershipStore.getAll() as IDBRequest<BookmarkFolderMembership[]>,
      ),
      requestAsPromise(
        seenStore.index("runId").getAll(runId) as IDBRequest<SeenRecord[]>,
      ),
    ]);
    const seenIds = new Set(seenRecords.map((seen) => seen.bookmarkId));
    const removedIds = new Set<string>();
    let archived = 0;

    for (const bookmark of bookmarks) {
      if (seenIds.has(bookmark.id)) continue;
      if (!keepArchived) {
        bookmarkStore.delete(bookmark.id);
        removedIds.add(bookmark.id);
        continue;
      }
      if (bookmark.status === "archived") continue;
      bookmarkStore.put({
        ...bookmark,
        archivedAt: completedAt,
        status: "archived",
      } satisfies BookmarkRecord);
      archived += 1;
    }
    if (removedIds.size > 0) {
      for (const membership of memberships) {
        if (removedIds.has(membership.bookmarkId)) {
          membershipStore.delete([membership.bookmarkId, membership.folderId]);
        }
      }
    }
    seenStore.clear();
    const meta: MetaRecord<string> = {
      key: "lastSuccessfulSyncAt",
      value: completedAt,
    };
    transaction.objectStore(META_STORE).put(meta);
    await transactionDone(transaction);
    return { archived, removed: removedIds.size };
  }

  async discardCapture(runId: string): Promise<number> {
    const database = await this.connection.open();
    const transaction = database.transaction(SEEN_STORE, "readwrite");
    const store = transaction.objectStore(SEEN_STORE);
    const keys = await requestAsPromise(store.index("runId").getAllKeys(runId));
    for (const key of keys) store.delete(key);
    await transactionDone(transaction);
    return keys.length;
  }

  async getAll(): Promise<HydratedBookmarkRecord[]> {
    const database = await this.connection.open();
    const transaction = database.transaction(
      [BOOKMARK_FOLDERS_STORE, BOOKMARKS_STORE, FOLDERS_STORE],
      "readonly",
    );
    const [bookmarks, memberships, folders] = await Promise.all([
      requestAsPromise(
        transaction.objectStore(BOOKMARKS_STORE).getAll() as IDBRequest<
          BookmarkRecord[]
        >,
      ),
      requestAsPromise(
        transaction.objectStore(BOOKMARK_FOLDERS_STORE).getAll() as IDBRequest<
          BookmarkFolderMembership[]
        >,
      ),
      requestAsPromise(
        transaction.objectStore(FOLDERS_STORE).getAll() as IDBRequest<FolderRecord[]>,
      ),
    ]);
    await transactionDone(transaction);

    const foldersById = new Map(
      folders
        .filter((folder) => folder.deletedAt === undefined)
        .map((folder) => [folder.id, folder]),
    );
    const folderIdsByBookmark = new Map<string, Set<string>>();
    for (const { bookmarkId, folderId } of memberships) {
      const folderIds = folderIdsByBookmark.get(bookmarkId) ?? new Set<string>();
      folderIds.add(folderId);
      folderIdsByBookmark.set(bookmarkId, folderIds);
    }

    return bookmarks.map((bookmark) => {
      const folderIds = folderIdsByBookmark.get(bookmark.id) ?? new Set<string>();
      if (bookmark.folderId !== null) folderIds.add(bookmark.folderId);
      const resolvedFolders = Array.from(folderIds)
        .map((folderId) => foldersById.get(folderId))
        .filter((folder): folder is FolderRecord => folder !== undefined)
        .map(({ id, name }) => ({ id, name }) satisfies BookmarkFolder);
      return { ...bookmark, folders: resolvedFolders };
    });
  }

  async getStats(): Promise<ArchiveStats> {
    const [bookmarks, lastSuccessfulSyncAt] = await Promise.all([
      this.getAll(),
      this.getMeta<string | null>("lastSuccessfulSyncAt", null),
    ]);
    const current = bookmarks.filter(({ status }) => status === "current").length;
    return {
      total: bookmarks.length,
      current,
      archived: bookmarks.length - current,
      lastSuccessfulSyncAt,
    };
  }

  async clear(): Promise<void> {
    const database = await this.connection.open();
    const transaction = database.transaction(
      [
        BOOKMARK_FOLDERS_STORE,
        BOOKMARKS_STORE,
        FOLDERS_STORE,
        META_STORE,
        SEEN_STORE,
        TAGS_STORE,
      ],
      "readwrite",
    );
    for (const storeName of [
      BOOKMARKS_STORE,
      BOOKMARK_FOLDERS_STORE,
      FOLDERS_STORE,
      META_STORE,
      SEEN_STORE,
      TAGS_STORE,
    ]) {
      transaction.objectStore(storeName).clear();
    }
    await transactionDone(transaction);
  }

  async setMeta<T>(key: string, value: T): Promise<void> {
    const database = await this.connection.open();
    const transaction = database.transaction(META_STORE, "readwrite");
    const record: MetaRecord<T> = { key, value };
    transaction.objectStore(META_STORE).put(record);
    await transactionDone(transaction);
  }

  async getMeta<T>(key: string, fallback: T): Promise<T> {
    const database = await this.connection.open();
    const transaction = database.transaction(META_STORE, "readonly");
    const record = await requestAsPromise(
      transaction.objectStore(META_STORE).get(key) as IDBRequest<
        MetaRecord<T> | undefined
      >,
    );
    await transactionDone(transaction);
    return record?.value ?? fallback;
  }
}
