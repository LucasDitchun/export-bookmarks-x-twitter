import type {
  ArchiveStats,
  BookmarkFolder,
  BookmarkFolderMembership,
  BookmarkRecord,
  BookmarkSnapshot,
  HydratedBookmarkRecord,
} from "../domain/types";
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
    let added = 0;
    let updated = 0;

    for (const bookmark of bookmarks) {
      const existing = await requestAsPromise(
        bookmarkStore.get(bookmark.id) as IDBRequest<BookmarkRecord | undefined>,
      );
      const record: BookmarkRecord = {
        ...bookmark,
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

  async finalizeCapture(runId: string, completedAt: string): Promise<void> {
    const database = await this.connection.open();
    const transaction = database.transaction(
      [BOOKMARKS_STORE, SEEN_STORE, META_STORE],
      "readwrite",
    );
    const bookmarkStore = transaction.objectStore(BOOKMARKS_STORE);
    const seenStore = transaction.objectStore(SEEN_STORE);
    const [bookmarks, seenRecords] = await Promise.all([
      requestAsPromise(bookmarkStore.getAll() as IDBRequest<BookmarkRecord[]>),
      requestAsPromise(
        seenStore.index("runId").getAll(runId) as IDBRequest<SeenRecord[]>,
      ),
    ]);
    const seenIds = new Set(seenRecords.map((seen) => seen.bookmarkId));

    for (const bookmark of bookmarks) {
      if (seenIds.has(bookmark.id) || bookmark.status === "archived") continue;
      bookmarkStore.put({
        ...bookmark,
        archivedAt: completedAt,
        status: "archived",
      } satisfies BookmarkRecord);
    }
    seenStore.clear();
    const meta: MetaRecord<string> = {
      key: "lastSuccessfulSyncAt",
      value: completedAt,
    };
    transaction.objectStore(META_STORE).put(meta);
    await transactionDone(transaction);
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
        transaction.objectStore(FOLDERS_STORE).getAll() as IDBRequest<BookmarkFolder[]>,
      ),
    ]);
    await transactionDone(transaction);

    const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
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
        .filter((folder): folder is BookmarkFolder => folder !== undefined);
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
