import type {
  BookmarkFolderMembership,
  BookmarkRecord,
  BookmarkTag,
  FolderRecord,
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

export interface SaveBookmarkMetadataInput {
  id: string;
  note: string;
  tags: string[];
  folderPath: string[];
}

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

function validateInput(input: SaveBookmarkMetadataInput): SaveBookmarkMetadataInput {
  if (input.note.length > MAX_BOOKMARK_METADATA_NOTE_LENGTH) {
    throw new RangeError("Bookmark notes cannot exceed 20,000 characters.");
  }
  if (input.tags.length > MAX_BOOKMARK_METADATA_TAGS) {
    throw new RangeError(
      `A bookmark can have at most ${MAX_BOOKMARK_METADATA_TAGS} tags.`,
    );
  }
  if (input.folderPath.length > MAX_BOOKMARK_METADATA_FOLDER_DEPTH) {
    throw new RangeError(
      `A folder path can have at most ${MAX_BOOKMARK_METADATA_FOLDER_DEPTH} levels.`,
    );
  }
  const tags = [
    ...new Map(
      input.tags.map((value) => {
        const name = tagDisplayName(value);
        return [normalizeTagName(name), name] as const;
      }),
    ).values(),
  ];
  const folderPath = input.folderPath.map(folderDisplayName);
  return { ...input, tags, folderPath };
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
    const tagIds = input.tags.map((name) => {
      const normalizedName = normalizeTagName(name);
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
      const tag: BookmarkTag = { id: this.createId(), name, normalizedName };
      tags.add(tag);
      activeTags.push(tag);
      return tag.id;
    });

    const activeFolders = storedFolders.filter(
      (folder) => folder.deletedAt === undefined,
    );
    let folderId: string | null = null;
    for (const name of input.folderPath) {
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

    for (const key of membershipKeys) memberships.delete(key);
    if (folderId !== null) {
      memberships.put({
        bookmarkId: input.id,
        folderId,
      } satisfies BookmarkFolderMembership);
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
