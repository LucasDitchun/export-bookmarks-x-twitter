import type {
  BookmarkFolderMembership,
  BookmarkRecord,
  FolderRecord,
} from "../domain/types";
import { sortFolders } from "../domain/folder-tree";
import {
  BOOKMARK_FOLDERS_STORE,
  BOOKMARKS_STORE,
  BookmarkDatabase,
  FOLDERS_STORE,
  requestAsPromise,
  transactionDone,
} from "./bookmark-database";

export const MAX_FOLDER_NAME_LENGTH = 100;

export interface CreateFolderInput {
  name: string;
  parentId: string | null;
}

export interface DeleteFolderResult {
  deletedFolderIds: string[];
  uncategorizedBookmarkCount: number;
}

export interface FolderRepositoryOptions {
  createId?: () => string;
  now?: () => Date;
}

function normalizeName(value: string): string {
  const name = value.trim();
  const hasControlCharacters = Array.from(name).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (
    name.length === 0 ||
    name.length > MAX_FOLDER_NAME_LENGTH ||
    hasControlCharacters
  ) {
    throw new RangeError(
      `Folder name must contain 1 to ${MAX_FOLDER_NAME_LENGTH} safe characters.`,
    );
  }
  return name;
}

function sameName(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function assertUniqueSibling(
  folders: readonly FolderRecord[],
  folder: Pick<FolderRecord, "name" | "parentId">,
  ignoredId?: string,
): void {
  if (
    folders.some(
      (candidate) =>
        candidate.id !== ignoredId &&
        candidate.parentId === folder.parentId &&
        sameName(candidate.name, folder.name),
    )
  ) {
    throw new Error("A folder with this name already exists in this location.");
  }
}

export class FolderRepository {
  private readonly connection: BookmarkDatabase;
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(databaseName = "bookmark-x", options: FolderRepositoryOptions = {}) {
    this.connection = new BookmarkDatabase(databaseName);
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
  }

  async list(): Promise<FolderRecord[]> {
    const database = await this.connection.open();
    const transaction = database.transaction(FOLDERS_STORE, "readonly");
    const folders = await requestAsPromise(
      transaction.objectStore(FOLDERS_STORE).getAll() as IDBRequest<FolderRecord[]>,
    );
    await transactionDone(transaction);
    return sortFolders(folders.filter((folder) => folder.deletedAt === undefined));
  }

  async usage(): Promise<Record<string, number>> {
    const database = await this.connection.open();
    const transaction = database.transaction(
      [FOLDERS_STORE, BOOKMARKS_STORE],
      "readonly",
    );
    const [folders, bookmarks] = await Promise.all([
      requestAsPromise(
        transaction.objectStore(FOLDERS_STORE).getAll() as IDBRequest<FolderRecord[]>,
      ),
      requestAsPromise(
        transaction.objectStore(BOOKMARKS_STORE).getAll() as IDBRequest<
          BookmarkRecord[]
        >,
      ),
    ]);
    await transactionDone(transaction);

    const byId = new Map(
      folders
        .filter((folder) => folder.deletedAt === undefined)
        .map((folder) => [folder.id, folder]),
    );
    const usage: Record<string, number> = {};
    for (const bookmark of bookmarks) {
      let folderId = bookmark.folderId;
      const visited = new Set<string>();
      while (folderId !== null && !visited.has(folderId)) {
        const folder = byId.get(folderId);
        if (!folder) break;
        visited.add(folderId);
        usage[folderId] = (usage[folderId] ?? 0) + 1;
        folderId = folder.parentId;
      }
    }
    return usage;
  }

  async create(input: CreateFolderInput): Promise<FolderRecord> {
    const name = normalizeName(input.name);
    const database = await this.connection.open();
    const transaction = database.transaction(FOLDERS_STORE, "readwrite");
    const store = transaction.objectStore(FOLDERS_STORE);
    const [folders, parent] = await Promise.all([
      requestAsPromise(store.getAll() as IDBRequest<FolderRecord[]>),
      input.parentId === null
        ? Promise.resolve(undefined)
        : requestAsPromise(
            store.get(input.parentId) as IDBRequest<FolderRecord | undefined>,
          ),
    ]);
    if (
      input.parentId !== null &&
      (parent === undefined || parent.deletedAt !== undefined)
    ) {
      transaction.abort();
      throw new Error("The parent folder was not found.");
    }
    assertUniqueSibling(
      folders.filter((folder) => folder.deletedAt === undefined),
      { name, parentId: input.parentId },
    );
    const folder: FolderRecord = {
      id: this.createId(),
      name,
      parentId: input.parentId,
    };
    store.add(folder);
    await transactionDone(transaction);
    return folder;
  }

  async rename(id: string, value: string): Promise<FolderRecord> {
    const name = normalizeName(value);
    const database = await this.connection.open();
    const transaction = database.transaction(FOLDERS_STORE, "readwrite");
    const store = transaction.objectStore(FOLDERS_STORE);
    const [folders, folder] = await Promise.all([
      requestAsPromise(store.getAll() as IDBRequest<FolderRecord[]>),
      requestAsPromise(store.get(id) as IDBRequest<FolderRecord | undefined>),
    ]);
    if (folder === undefined || folder.deletedAt !== undefined) {
      transaction.abort();
      throw new Error(`Folder ${id} was not found.`);
    }
    assertUniqueSibling(
      folders.filter((candidate) => candidate.deletedAt === undefined),
      { name, parentId: folder.parentId },
      id,
    );
    const updated = { ...folder, name };
    store.put(updated);
    await transactionDone(transaction);
    return updated;
  }

  async assignBookmark(
    bookmarkId: string,
    folderId: string | null,
  ): Promise<BookmarkRecord> {
    const database = await this.connection.open();
    const transaction = database.transaction(
      [BOOKMARKS_STORE, FOLDERS_STORE, BOOKMARK_FOLDERS_STORE],
      "readwrite",
    );
    const bookmarks = transaction.objectStore(BOOKMARKS_STORE);
    const folders = transaction.objectStore(FOLDERS_STORE);
    const memberships = transaction.objectStore(BOOKMARK_FOLDERS_STORE);
    const [bookmark, folder, membershipKeys] = await Promise.all([
      requestAsPromise(
        bookmarks.get(bookmarkId) as IDBRequest<BookmarkRecord | undefined>,
      ),
      folderId === null
        ? Promise.resolve(undefined)
        : requestAsPromise(
            folders.get(folderId) as IDBRequest<FolderRecord | undefined>,
          ),
      requestAsPromise(
        memberships.index("byBookmark").getAllKeys(IDBKeyRange.only(bookmarkId)),
      ),
    ]);
    if (bookmark === undefined) {
      transaction.abort();
      throw new Error(`Bookmark ${bookmarkId} was not found.`);
    }
    if (folderId !== null && (folder === undefined || folder.deletedAt !== undefined)) {
      transaction.abort();
      throw new Error(`Folder ${folderId} was not found.`);
    }

    for (const key of membershipKeys) memberships.delete(key);
    if (folderId !== null) {
      memberships.put({ bookmarkId, folderId } satisfies BookmarkFolderMembership);
    }
    const updated: BookmarkRecord = {
      ...bookmark,
      folderId,
      metadataUpdatedAt: this.now().toISOString(),
    };
    bookmarks.put(updated);
    await transactionDone(transaction);
    return updated;
  }

  async delete(id: string): Promise<DeleteFolderResult> {
    const database = await this.connection.open();
    const transaction = database.transaction(
      [FOLDERS_STORE, BOOKMARKS_STORE, BOOKMARK_FOLDERS_STORE],
      "readwrite",
    );
    const folderStore = transaction.objectStore(FOLDERS_STORE);
    const bookmarkStore = transaction.objectStore(BOOKMARKS_STORE);
    const membershipStore = transaction.objectStore(BOOKMARK_FOLDERS_STORE);
    const folders = await requestAsPromise(
      folderStore.getAll() as IDBRequest<FolderRecord[]>,
    );
    if (!folders.some((folder) => folder.id === id && folder.deletedAt === undefined)) {
      transaction.abort();
      throw new Error(`Folder ${id} was not found.`);
    }

    const deleted = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of folders) {
        if (folder.parentId !== null && deleted.has(folder.parentId)) {
          const size = deleted.size;
          deleted.add(folder.id);
          changed ||= deleted.size !== size;
        }
      }
    }
    const deletedFolderIds = folders
      .filter((folder) => folder.deletedAt === undefined && deleted.has(folder.id))
      .map(({ id: folderId }) => folderId);
    const bookmarkGroups = await Promise.all(
      deletedFolderIds.map((folderId) =>
        requestAsPromise(
          bookmarkStore
            .index("byFolder")
            .getAll(IDBKeyRange.only(folderId)) as IDBRequest<BookmarkRecord[]>,
        ),
      ),
    );
    const membershipKeyGroups = await Promise.all(
      deletedFolderIds.map((folderId) =>
        requestAsPromise(
          membershipStore.index("byFolder").getAllKeys(IDBKeyRange.only(folderId)),
        ),
      ),
    );
    const affectedBookmarks = bookmarkGroups.flat();
    const timestamp = this.now().toISOString();
    for (const bookmark of affectedBookmarks) {
      bookmarkStore.put({
        ...bookmark,
        folderId: null,
        metadataUpdatedAt: timestamp,
      } satisfies BookmarkRecord);
    }
    for (const keys of membershipKeyGroups) {
      for (const key of keys) membershipStore.delete(key);
    }
    for (const folderId of deletedFolderIds) {
      const folder = folders.find((candidate) => candidate.id === folderId);
      if (folder) folderStore.put({ ...folder, deletedAt: timestamp });
    }
    await transactionDone(transaction);
    return {
      deletedFolderIds,
      uncategorizedBookmarkCount: affectedBookmarks.length,
    };
  }
}
