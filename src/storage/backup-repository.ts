import {
  BACKUP_SCHEMA_VERSION,
  parseBackup,
  serializeBackup,
  validateBackup,
  type BackupSettings,
  type BookmarkXBackup,
} from "../domain/backup";
import {
  isSupportedLocale,
  type BookmarkFolderMembership,
  type BookmarkRecord,
  type BookmarkTag,
  type FolderRecord,
} from "../domain/types";
import {
  SETTINGS_SCHEMA_VERSION,
  SETTINGS_STORAGE_KEY,
  type ExtensionSettings,
  type SettingsRepository,
} from "../settings/settings-repository";
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
import { normalizeTagName } from "./tag-repository";

const UI_LOCALE_KEY = "uiLocale";
const LAST_SYNC_KEY = "lastSuccessfulSyncAt";
const USER_STORES = [
  BOOKMARKS_STORE,
  FOLDERS_STORE,
  TAGS_STORE,
  BOOKMARK_FOLDERS_STORE,
] as const;
const ALL_STORES = [...USER_STORES, META_STORE, SEEN_STORE] as const;

interface MetaRecord<T> {
  key: string;
  value: T;
}

export type RestoreMode = "merge" | "replace";

export interface BackupStorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface BackupRepositoryOptions {
  storage: BackupStorageArea;
  /** Logical settings snapshot; migrations and defaults stay owned by S06. */
  settings: Pick<SettingsRepository, "get">;
  now?: () => Date;
  /** Synchronous hook for invalidating derived in-memory indexes after IDB commits. */
  onDataRestored?: () => void;
}

export interface BackupExportResult {
  content: string;
  filename: string;
}

export interface BackupRestoreResult {
  bookmarks: number;
  folders: number;
  tags: number;
  mode: RestoreMode;
  reloadRequired: true;
}

export class BackupSettingsWriteError extends Error {
  readonly code = "restore_settings_failed";

  constructor() {
    super(
      "The library was restored, but Bookmark X could not apply the backed-up settings.",
    );
    this.name = "BackupSettingsWriteError";
  }
}

function sortById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => left.id.localeCompare(right.id));
}

function canonicalTagSnapshot(tag: BookmarkTag): BookmarkTag {
  const snapshot: BookmarkTag = {
    id: tag.id,
    name: tag.name,
    normalizedName: tag.normalizedName,
  };
  if (tag.deletedAt !== undefined) snapshot.deletedAt = tag.deletedAt;
  return snapshot;
}

function exportFilename(now: Date): string {
  const timestamp = now
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d{3}Z$/, "Z");
  return `bookmark-x-backup-${timestamp}.json`;
}

function settingsFromStorage(
  values: Record<string, unknown>,
  extension: ExtensionSettings,
): BackupSettings {
  return {
    uiLocale: isSupportedLocale(values[UI_LOCALE_KEY]) ? values[UI_LOCALE_KEY] : null,
    extension: {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      settings: extension,
    },
  };
}

function membershipsFor(
  bookmarks: readonly BookmarkRecord[],
): BookmarkFolderMembership[] {
  return bookmarks.flatMap((bookmark) =>
    bookmark.folderId === null
      ? []
      : [{ bookmarkId: bookmark.id, folderId: bookmark.folderId }],
  );
}

function backupTagRemaps(
  localTags: readonly BookmarkTag[],
  backupTags: readonly BookmarkTag[],
): Map<string, string> {
  const activeLocalTags = localTags.filter((tag) => tag.deletedAt === undefined);
  const activeBackupTags = backupTags.filter((tag) => tag.deletedAt === undefined);
  const backupIds = new Set(backupTags.map(({ id }) => id));
  const backupByName = new Map(
    activeBackupTags.map(({ normalizedName, id }) => [normalizedName, id]),
  );
  const remaps = new Map<string, string>();
  for (const tag of activeLocalTags) {
    const backupId = backupByName.get(tag.normalizedName);
    if (!backupIds.has(tag.id) && backupId !== undefined) {
      remaps.set(tag.id, backupId);
    }
  }
  return remaps;
}

function mergeBackup(
  local: Pick<BookmarkXBackup["data"], "bookmarks" | "folders" | "tags">,
  backup: BookmarkXBackup,
): BookmarkXBackup {
  const tagRemaps = backupTagRemaps(local.tags, backup.data.tags);
  const tags = new Map(local.tags.map((tag) => [tag.id, tag]));
  for (const oldId of tagRemaps.keys()) tags.delete(oldId);
  for (const tag of backup.data.tags) tags.set(tag.id, tag);

  const folders = new Map(local.folders.map((folder) => [folder.id, folder]));
  for (const folder of backup.data.folders) folders.set(folder.id, folder);

  // Folder deletion is recursive in the live application. A merge can introduce
  // a tombstoned backup parent above a local-only active descendant, so close the
  // merged subtree before validating/persisting it.
  let folderDeletionChanged = true;
  while (folderDeletionChanged) {
    folderDeletionChanged = false;
    for (const [id, folder] of folders) {
      if (folder.deletedAt !== undefined || folder.parentId === null) continue;
      const parent = folders.get(folder.parentId);
      if (parent?.deletedAt === undefined) continue;
      folders.set(id, { ...folder, deletedAt: parent.deletedAt });
      folderDeletionChanged = true;
    }
  }

  const bookmarks = new Map(
    local.bookmarks.map((bookmark) => [
      bookmark.id,
      {
        ...bookmark,
        tagIds: bookmark.tagIds.map((id) => tagRemaps.get(id) ?? id),
      },
    ]),
  );
  for (const bookmark of backup.data.bookmarks) bookmarks.set(bookmark.id, bookmark);

  return {
    ...backup,
    data: {
      ...backup.data,
      bookmarks: sortById([...bookmarks.values()]),
      folders: sortById([...folders.values()]),
      tags: sortById([...tags.values()]),
    },
  };
}

export class BackupRepository {
  private readonly connection: BookmarkDatabase;
  private readonly now: () => Date;

  constructor(
    databaseName = "bookmark-x",
    private readonly options: BackupRepositoryOptions,
  ) {
    this.connection = new BookmarkDatabase(databaseName);
    this.now = options.now ?? (() => new Date());
  }

  async export(): Promise<BackupExportResult> {
    const exportedAt = this.now();
    const database = await this.connection.open();
    const transaction = database.transaction(
      [BOOKMARKS_STORE, FOLDERS_STORE, TAGS_STORE, META_STORE],
      "readonly",
    );
    const [bookmarks, folders, tags, sync] = await Promise.all([
      requestAsPromise(
        transaction.objectStore(BOOKMARKS_STORE).getAll() as IDBRequest<
          BookmarkRecord[]
        >,
      ),
      requestAsPromise(
        transaction.objectStore(FOLDERS_STORE).getAll() as IDBRequest<FolderRecord[]>,
      ),
      requestAsPromise(
        transaction.objectStore(TAGS_STORE).getAll() as IDBRequest<BookmarkTag[]>,
      ),
      requestAsPromise(
        transaction.objectStore(META_STORE).get(LAST_SYNC_KEY) as IDBRequest<
          MetaRecord<unknown> | undefined
        >,
      ),
    ]);
    await transactionDone(transaction);
    // Never await chrome.storage inside an IndexedDB transaction: the IDB
    // complete event may fire before transactionDone installs its listener.
    const [storedSettings, extensionSettings] = await Promise.all([
      this.options.storage.get(UI_LOCALE_KEY),
      this.options.settings.get(),
    ]);
    const lastSuccessfulSyncAt = typeof sync?.value === "string" ? sync.value : null;
    const backup: BookmarkXBackup = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: exportedAt.toISOString(),
      data: {
        bookmarks: sortById(bookmarks),
        folders: sortById(folders),
        tags: sortById(
          tags.map(canonicalTagSnapshot).map((tag) => ({
            ...tag,
            name: tag.name.trim().normalize("NFKC"),
            normalizedName: normalizeTagName(tag.name),
          })),
        ),
        archive: { lastSuccessfulSyncAt },
        settings: settingsFromStorage(storedSettings, extensionSettings),
      },
    };
    return {
      content: serializeBackup(backup),
      filename: exportFilename(exportedAt),
    };
  }

  async restore(content: string, mode: RestoreMode): Promise<BackupRestoreResult> {
    const imported = parseBackup(content);
    const data = mode === "merge" ? await this.mergeWithLocal(imported) : imported;
    // Revalidate the combined merge graph before opening a write transaction.
    const validated = validateBackup(data);
    await this.writeIdb(validated, mode);
    try {
      this.options.onDataRestored?.();
    } catch {
      // Derived caches are disposable. A failed invalidation must not turn an
      // already committed restore into an ambiguous partial failure.
    }

    try {
      // IndexedDB and chrome.storage cannot share a transaction. Applying this
      // after IDB guarantees an IDB failure never changes settings; a failure
      // here is reported explicitly as an IDB-complete/settings-pending result.
      await this.options.storage.set({
        [UI_LOCALE_KEY]: validated.data.settings.uiLocale,
        [SETTINGS_STORAGE_KEY]: validated.data.settings.extension,
      });
    } catch {
      throw new BackupSettingsWriteError();
    }

    return {
      bookmarks: validated.data.bookmarks.length,
      folders: validated.data.folders.length,
      tags: validated.data.tags.length,
      mode,
      reloadRequired: true,
    };
  }

  private async mergeWithLocal(backup: BookmarkXBackup): Promise<BookmarkXBackup> {
    const database = await this.connection.open();
    const transaction = database.transaction(
      [BOOKMARKS_STORE, FOLDERS_STORE, TAGS_STORE],
      "readonly",
    );
    const [bookmarks, folders, tags] = await Promise.all([
      requestAsPromise(
        transaction.objectStore(BOOKMARKS_STORE).getAll() as IDBRequest<
          BookmarkRecord[]
        >,
      ),
      requestAsPromise(
        transaction.objectStore(FOLDERS_STORE).getAll() as IDBRequest<FolderRecord[]>,
      ),
      requestAsPromise(
        transaction.objectStore(TAGS_STORE).getAll() as IDBRequest<BookmarkTag[]>,
      ),
    ]);
    await transactionDone(transaction);
    return mergeBackup(
      {
        bookmarks,
        folders,
        tags: tags.map(canonicalTagSnapshot),
      },
      backup,
    );
  }

  private async writeIdb(backup: BookmarkXBackup, mode: RestoreMode): Promise<void> {
    const database = await this.connection.open();
    const transaction = database.transaction(
      mode === "replace" ? [...ALL_STORES] : [...USER_STORES, META_STORE],
      "readwrite",
    );
    const bookmarks = transaction.objectStore(BOOKMARKS_STORE);
    const folders = transaction.objectStore(FOLDERS_STORE);
    const tags = transaction.objectStore(TAGS_STORE);
    const memberships = transaction.objectStore(BOOKMARK_FOLDERS_STORE);
    const meta = transaction.objectStore(META_STORE);
    let completionStarted = false;

    try {
      // Every target collection is already complete (including a merged view),
      // so clear+rebuild inside one IDB transaction avoids stale indexes/refs.
      for (const storeName of USER_STORES) {
        transaction.objectStore(storeName).clear();
      }
      if (mode === "replace") {
        meta.clear();
        transaction.objectStore(SEEN_STORE).clear();
      }
      for (const bookmark of backup.data.bookmarks) bookmarks.put(bookmark);
      for (const folder of backup.data.folders) folders.put(folder);
      for (const tag of backup.data.tags) tags.put(tag);
      for (const membership of membershipsFor(backup.data.bookmarks)) {
        memberships.put(membership);
      }
      if (backup.data.archive.lastSuccessfulSyncAt === null) {
        meta.delete(LAST_SYNC_KEY);
      } else {
        meta.put({
          key: LAST_SYNC_KEY,
          value: backup.data.archive.lastSuccessfulSyncAt,
        } satisfies MetaRecord<string>);
      }
      completionStarted = true;
      await transactionDone(transaction);
    } catch (error) {
      if (!completionStarted) {
        transaction.abort();
        await transactionDone(transaction).catch(() => undefined);
      }
      throw error;
    }
  }
}
