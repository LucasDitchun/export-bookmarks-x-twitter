import type { ArchiveStats, BookmarkRecord, BookmarkSnapshot } from "../domain/types";

const DATABASE_VERSION = 1;
const BOOKMARKS_STORE = "bookmarks";
const SEEN_STORE = "seen";
const META_STORE = "meta";

interface SeenRecord {
  key: string;
  runId: string;
  bookmarkId: string;
}

interface MetaRecord<T> {
  key: string;
  value: T;
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("IndexedDB request failed.")),
      { once: true },
    );
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener(
      "abort",
      () => reject(transaction.error ?? new Error("IndexedDB transaction aborted.")),
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => reject(transaction.error ?? new Error("IndexedDB transaction failed.")),
      { once: true },
    );
  });
}

export class ArchiveRepository {
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly databaseName = "bookmark-x") {}

  private open(): Promise<IDBDatabase> {
    this.databasePromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, DATABASE_VERSION);
      request.addEventListener("upgradeneeded", () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(BOOKMARKS_STORE)) {
          database.createObjectStore(BOOKMARKS_STORE, { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains(SEEN_STORE)) {
          const seen = database.createObjectStore(SEEN_STORE, { keyPath: "key" });
          seen.createIndex("runId", "runId", { unique: false });
        }
        if (!database.objectStoreNames.contains(META_STORE)) {
          database.createObjectStore(META_STORE, { keyPath: "key" });
        }
      });
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener(
        "error",
        () => reject(request.error ?? new Error("IndexedDB open failed.")),
        { once: true },
      );
    });
    return this.databasePromise;
  }

  async mergeBookmarks(
    bookmarks: readonly BookmarkSnapshot[],
    runId: string,
    seenAt: string,
  ): Promise<{ added: number; updated: number }> {
    const database = await this.open();
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
        folders: [],
        firstArchivedAt: existing?.firstArchivedAt ?? seenAt,
        lastSeenAt: seenAt,
        isCurrent: existing?.isCurrent ?? false,
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
    const database = await this.open();
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
      bookmarkStore.put({
        ...bookmark,
        isCurrent: seenIds.has(bookmark.id),
      });
    }
    seenStore.clear();
    const meta: MetaRecord<string> = {
      key: "lastSuccessfulSyncAt",
      value: completedAt,
    };
    transaction.objectStore(META_STORE).put(meta);
    await transactionDone(transaction);
  }

  async getAll(): Promise<BookmarkRecord[]> {
    const database = await this.open();
    const transaction = database.transaction(BOOKMARKS_STORE, "readonly");
    const result = await requestAsPromise(
      transaction.objectStore(BOOKMARKS_STORE).getAll() as IDBRequest<BookmarkRecord[]>,
    );
    await transactionDone(transaction);
    return result;
  }

  async getStats(): Promise<ArchiveStats> {
    const [bookmarks, lastSuccessfulSyncAt] = await Promise.all([
      this.getAll(),
      this.getMeta<string | null>("lastSuccessfulSyncAt", null),
    ]);
    const current = bookmarks.filter((bookmark) => bookmark.isCurrent).length;
    return {
      total: bookmarks.length,
      current,
      archived: bookmarks.length - current,
      lastSuccessfulSyncAt,
    };
  }

  async clear(): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(
      [BOOKMARKS_STORE, SEEN_STORE, META_STORE],
      "readwrite",
    );
    transaction.objectStore(BOOKMARKS_STORE).clear();
    transaction.objectStore(SEEN_STORE).clear();
    transaction.objectStore(META_STORE).clear();
    await transactionDone(transaction);
  }

  async setMeta<T>(key: string, value: T): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(META_STORE, "readwrite");
    const record: MetaRecord<T> = { key, value };
    transaction.objectStore(META_STORE).put(record);
    await transactionDone(transaction);
  }

  async getMeta<T>(key: string, fallback: T): Promise<T> {
    const database = await this.open();
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
