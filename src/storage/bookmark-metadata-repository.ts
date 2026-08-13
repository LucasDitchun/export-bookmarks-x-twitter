import type {
  BookmarkFolderMembership,
  BookmarkRecord,
  BookmarkTag,
  FolderRecord,
  SaveBookmarkMetadataInput,
} from "../domain/types";
import {
  BOOKMARK_FOLDERS_STORE,
  BOOKMARKS_STORE,
  BookmarkDatabase,
  FOLDERS_STORE,
  TAGS_STORE,
  requestAsPromise,
  transactionDone,
} from "./bookmark-database";
import { MAX_FOLDER_NAME_LENGTH } from "./folder-repository";
import { MAX_TAG_NAME_LENGTH, normalizeTagName } from "./tag-repository";

export const MAX_BOOKMARK_METADATA_TAGS = 50;
export const MAX_BOOKMARK_METADATA_FOLDER_DEPTH = 32;
export const MAX_BOOKMARK_METADATA_NOTE_LENGTH = 20_000;

export interface BookmarkMetadataRepositoryOptions {
  createId?: () => string;
  now?: () => Date;
}

type StoredBookmarkTag = Omit<BookmarkTag, "normalizedName"> & {
  normalizedName?: string;
};

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function tagDisplayName(value: string): string {
  const name = value.trim().normalize("NFKC");
  if (
    name.length === 0 ||
    name.length > MAX_TAG_NAME_LENGTH ||
    hasControlCharacters(name)
  ) {
    throw new RangeError(
      `Tag names must contain 1 to ${MAX_TAG_NAME_LENGTH} safe characters.`,
    );
  }
  return name;
}

function folderDisplayName(value: string): string {
  const name = value.trim();
  if (
    name.length === 0 ||
    name.length > MAX_FOLDER_NAME_LENGTH ||
    hasControlCharacters(name)
  ) {
    throw new RangeError(
      `Folder names must contain 1 to ${MAX_FOLDER_NAME_LENGTH} safe characters.`,
    );
  }
  return name;
}

function sameFolderName(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;
}

function localEntityId(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new RangeError("The selected organization ID is invalid.");
  }
  return value;
}

function validateInput(input: SaveBookmarkMetadataInput): SaveBookmarkMetadataInput {
  if (input.note.length > MAX_BOOKMARK_METADATA_NOTE_LENGTH) {
    throw new RangeError("Bookmark notes cannot exceed 20,000 characters.");
  }
  if (input.tags.length > MAX_BOOKMARK_METADATA_TAGS) {
    throw new RangeError(
      `A bookmark can have at most ${MAX_BOOKMARK_METADATA_TAGS} tags.`,
    );
  }
  const tags = [
    ...new Map(
      input.tags.map((tag) => {
        const name = tagDisplayName(tag.name);
        const id = tag.id === null ? null : localEntityId(tag.id);
        return [
          id === null ? `name:${normalizeTagName(name)}` : `id:${id}`,
          {
            id,
            name,
          },
        ] as const;
      }),
    ).values(),
  ];
  const rawFolder = input.folder;
  const folder = rawFolder && {
    id: rawFolder.id === null ? null : localEntityId(rawFolder.id),
    path: rawFolder.path.map(folderDisplayName),
    ...(rawFolder.newSegments === undefined
      ? {}
      : { newSegments: rawFolder.newSegments.map(folderDisplayName) }),
  };
  if ((folder?.path.length ?? 0) > MAX_BOOKMARK_METADATA_FOLDER_DEPTH) {
    throw new RangeError(
      `A folder path can have at most ${MAX_BOOKMARK_METADATA_FOLDER_DEPTH} levels.`,
    );
  }
  if (
    (folder?.newSegments?.length ?? 0) > MAX_BOOKMARK_METADATA_FOLDER_DEPTH ||
    (folder?.id === null && folder.newSegments !== undefined)
  ) {
    throw new RangeError("The selected folder hierarchy is invalid.");
  }
  const organizationChanges = input.organizationChanges ?? {
    tags: true,
    folder: true,
  };
  return { id: input.id, note: input.note, tags, folder, organizationChanges };
}

export class BookmarkMetadataRepository {
  private readonly connection: BookmarkDatabase;
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(
    databaseName = "bookmark-x",
    options: BookmarkMetadataRepositoryOptions = {},
  ) {
    this.connection = new BookmarkDatabase(databaseName);
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
  }

  async save(rawInput: SaveBookmarkMetadataInput): Promise<BookmarkRecord> {
    const input = validateInput(rawInput);
    const database = await this.connection.open();
    const transaction = database.transaction(
      [BOOKMARKS_STORE, TAGS_STORE, FOLDERS_STORE, BOOKMARK_FOLDERS_STORE],
      "readwrite",
    );
    const bookmarks = transaction.objectStore(BOOKMARKS_STORE);
    const tags = transaction.objectStore(TAGS_STORE);
    const folders = transaction.objectStore(FOLDERS_STORE);
    const memberships = transaction.objectStore(BOOKMARK_FOLDERS_STORE);
    const [bookmark, storedTags, storedFolders, membershipKeys] = await Promise.all([
      requestAsPromise(
        bookmarks.get(input.id) as IDBRequest<BookmarkRecord | undefined>,
      ),
      requestAsPromise(tags.getAll() as IDBRequest<StoredBookmarkTag[]>),
      requestAsPromise(folders.getAll() as IDBRequest<FolderRecord[]>),
      requestAsPromise(
        memberships.index("byBookmark").getAllKeys(IDBKeyRange.only(input.id)),
      ),
    ]);
    if (bookmark === undefined) {
      transaction.abort();
      await transactionDone(transaction).catch(() => undefined);
      throw new Error(`Bookmark ${input.id} was not found.`);
    }

    const activeTags = storedTags.filter((tag) => tag.deletedAt === undefined);
    const tagsChanged = input.organizationChanges?.tags ?? true;
    const folderChanged = input.organizationChanges?.folder ?? true;
    const missingTag = tagsChanged
      ? input.tags.find(
          (selection) =>
            selection.id !== null && !activeTags.some((tag) => tag.id === selection.id),
        )
      : undefined;
    const activeFolders = storedFolders.filter(
      (folder) => folder.deletedAt === undefined,
    );
    const selectedFolderId = input.folder?.id ?? null;
    if (
      missingTag?.id !== undefined ||
      (folderChanged &&
        selectedFolderId !== null &&
        !activeFolders.some((folder) => folder.id === selectedFolderId))
    ) {
      transaction.abort();
      await transactionDone(transaction).catch(() => undefined);
      if (missingTag?.id) {
        throw new Error(`Selected tag ${missingTag.id} is no longer available.`);
      }
      throw new Error(`Selected folder ${selectedFolderId} is no longer available.`);
    }
    const tagIds = tagsChanged
      ? [
          ...new Set(
            input.tags.map((selection) => {
              if (selection.id !== null) {
                return selection.id;
              }
              const normalizedName = normalizeTagName(selection.name);
              const existing = activeTags.find(
                (tag) => normalizeTagName(tag.name) === normalizedName,
              );
              if (existing !== undefined) {
                const hydrated: BookmarkTag = {
                  ...existing,
                  name: tagDisplayName(existing.name),
                  normalizedName,
                };
                if (
                  existing.name !== hydrated.name ||
                  existing.normalizedName !== hydrated.normalizedName
                ) {
                  tags.put(hydrated);
                }
                return hydrated.id;
              }
              const tag: BookmarkTag = {
                id: this.createId(),
                name: selection.name,
                normalizedName,
              };
              tags.add(tag);
              activeTags.push(tag);
              return tag.id;
            }),
          ),
        ]
      : bookmark.tagIds;

    let folderId: string | null = folderChanged ? selectedFolderId : bookmark.folderId;
    const newFolderSegments =
      input.folder?.id === null ? input.folder.path : (input.folder?.newSegments ?? []);
    for (const name of folderChanged ? newFolderSegments : []) {
      let folder = activeFolders.find(
        (candidate) =>
          candidate.parentId === folderId && sameFolderName(candidate.name, name),
      );
      if (folder === undefined) {
        folder = { id: this.createId(), name, parentId: folderId };
        folders.add(folder);
        activeFolders.push(folder);
      }
      folderId = folder.id;
    }

    if (folderChanged) {
      for (const key of membershipKeys) memberships.delete(key);
      if (folderId !== null) {
        memberships.put({
          bookmarkId: input.id,
          folderId,
        } satisfies BookmarkFolderMembership);
      }
    }
    const updated: BookmarkRecord = {
      ...bookmark,
      note: input.note,
      tagIds,
      folderId,
      metadataUpdatedAt: this.now().toISOString(),
    };
    bookmarks.put(updated);
    await transactionDone(transaction);
    return updated;
  }
}
