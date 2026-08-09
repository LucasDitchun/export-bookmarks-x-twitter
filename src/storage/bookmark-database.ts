import type {
  BookmarkFolder,
  BookmarkFolderMembership,
  BookmarkRecord,
} from "../domain/types";

export const BOOKMARK_DATABASE_VERSION = 2;
export const BOOKMARK_FOLDERS_STORE = "bookmarkFolders";
export const BOOKMARKS_STORE = "bookmarks";
export const FOLDERS_STORE = "folders";
export const META_STORE = "meta";
export const SEEN_STORE = "seen";
export const TAGS_STORE = "tags";

interface LegacyBookmarkRecord {
  id: string;
  text: string;
  url: string;
  author: BookmarkRecord["author"];
  postCreatedAt: string;
  folders: BookmarkFolder[];
  firstArchivedAt: string;
  lastSeenAt: string;
  isCurrent: boolean;
}

export interface BookmarkDatabaseOptions {
  factory?: IDBFactory;
  onBlocked?: (event: IDBVersionChangeEvent) => void;
}

function createBookmarkIndexes(store: IDBObjectStore): void {
  if (!store.indexNames.contains("byStatusSaved")) {
    store.createIndex("byStatusSaved", ["status", "firstSavedAt", "id"], {
      unique: false,
    });
  }
  if (!store.indexNames.contains("byFolder")) {
    store.createIndex("byFolder", "folderId", { unique: false });
  }
  if (!store.indexNames.contains("byTag")) {
    store.createIndex("byTag", "tagIds", { multiEntry: true, unique: false });
  }
}

function createNamedStore(database: IDBDatabase, name: string): IDBObjectStore {
  const store = database.createObjectStore(name, { keyPath: "id" });
  store.createIndex("byName", "name", { unique: false });
  return store;
}

function createBookmarkFoldersStore(database: IDBDatabase): IDBObjectStore {
  const store = database.createObjectStore(BOOKMARK_FOLDERS_STORE, {
    keyPath: ["bookmarkId", "folderId"],
  });
  store.createIndex("byBookmark", "bookmarkId", { unique: false });
  store.createIndex("byFolder", "folderId", { unique: false });
  return store;
}

function migrateVersionOne(transaction: IDBTransaction): void {
  const bookmarks = transaction.objectStore(BOOKMARKS_STORE);
  const folders = transaction.objectStore(FOLDERS_STORE);
  const bookmarkFolders = transaction.objectStore(BOOKMARK_FOLDERS_STORE);
  const cursorRequest = bookmarks.openCursor();

  cursorRequest.addEventListener("success", () => {
    const cursor = cursorRequest.result;
    if (cursor === null) return;

    const legacy = cursor.value as LegacyBookmarkRecord;
    const firstSavedAt = legacy.firstArchivedAt;
    const folder = legacy.folders[0] ?? null;
    for (const legacyFolder of legacy.folders) {
      folders.put(legacyFolder);
      bookmarkFolders.put({
        bookmarkId: legacy.id,
        folderId: legacyFolder.id,
      } satisfies BookmarkFolderMembership);
    }

    const migrated: BookmarkRecord = {
      id: legacy.id,
      text: legacy.text,
      url: legacy.url,
      author: legacy.author,
      postCreatedAt: legacy.postCreatedAt,
      note: "",
      folderId: folder?.id ?? null,
      tagIds: [],
      firstSavedAt,
      lastSeenAt: legacy.lastSeenAt,
      archivedAt: legacy.isCurrent ? null : legacy.lastSeenAt,
      metadataUpdatedAt: firstSavedAt,
      status: legacy.isCurrent ? "current" : "archived",
    };
    cursor.update(migrated);
    cursor.continue();
  });
}

function upgradeSchema(request: IDBOpenDBRequest, event: IDBVersionChangeEvent): void {
  const database = request.result;
  const transaction = request.transaction;
  if (transaction === null) throw new Error("Missing IndexedDB upgrade transaction.");

  const bookmarks = database.objectStoreNames.contains(BOOKMARKS_STORE)
    ? transaction.objectStore(BOOKMARKS_STORE)
    : database.createObjectStore(BOOKMARKS_STORE, { keyPath: "id" });
  createBookmarkIndexes(bookmarks);

  if (!database.objectStoreNames.contains(SEEN_STORE)) {
    const seen = database.createObjectStore(SEEN_STORE, { keyPath: "key" });
    seen.createIndex("runId", "runId", { unique: false });
  }
  if (!database.objectStoreNames.contains(META_STORE)) {
    database.createObjectStore(META_STORE, { keyPath: "key" });
  }
  if (!database.objectStoreNames.contains(FOLDERS_STORE)) {
    createNamedStore(database, FOLDERS_STORE);
  }
  if (!database.objectStoreNames.contains(BOOKMARK_FOLDERS_STORE)) {
    createBookmarkFoldersStore(database);
  }
  if (!database.objectStoreNames.contains(TAGS_STORE)) {
    createNamedStore(database, TAGS_STORE);
  }

  if (event.oldVersion === 1) migrateVersionOne(transaction);
}

export function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
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

export function transactionDone(transaction: IDBTransaction): Promise<void> {
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

export class BookmarkDatabase {
  private databasePromise: Promise<IDBDatabase> | null = null;
  private readonly factory: IDBFactory;

  constructor(
    private readonly databaseName = "bookmark-x",
    private readonly options: BookmarkDatabaseOptions = {},
  ) {
    this.factory = options.factory ?? indexedDB;
  }

  open(): Promise<IDBDatabase> {
    if (this.databasePromise !== null) return this.databasePromise;

    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(this.databaseName, BOOKMARK_DATABASE_VERSION);
      request.addEventListener("upgradeneeded", (event) => {
        upgradeSchema(request, event);
      });
      request.addEventListener("blocked", (event) => {
        this.options.onBlocked?.(event);
      });
      request.addEventListener(
        "success",
        () => {
          const database = request.result;
          database.addEventListener("versionchange", () => {
            database.close();
            if (this.databasePromise === opening) this.databasePromise = null;
          });
          resolve(database);
        },
        { once: true },
      );
      request.addEventListener(
        "error",
        () => reject(request.error ?? new Error("IndexedDB open failed.")),
        { once: true },
      );
    });

    this.databasePromise = opening;
    void opening.catch(() => {
      if (this.databasePromise === opening) this.databasePromise = null;
    });
    return opening;
  }

  async close(): Promise<void> {
    const opening = this.databasePromise;
    this.databasePromise = null;
    if (opening !== null) (await opening).close();
  }
}
