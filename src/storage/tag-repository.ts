import type { BookmarkRecord, BookmarkTag } from "../domain/types";
import {
  BOOKMARKS_STORE,
  BookmarkDatabase,
  TAGS_STORE,
  requestAsPromise,
  transactionDone,
} from "./bookmark-database";

export const MAX_TAG_NAME_LENGTH = 50;

export interface TagAssignment {
  bookmark: BookmarkRecord;
  tag: BookmarkTag;
}

export interface TagRepositoryOptions {
  createId?: () => string;
  now?: () => Date;
}

type StoredBookmarkTag = Omit<BookmarkTag, "normalizedName"> & {
  normalizedName?: string;
};

export function normalizeTagName(value: string): string {
  return value
    .trim()
    .normalize("NFKC")
    .toLocaleUpperCase("und")
    .toLocaleLowerCase("und");
}

function displayTagName(value: string): string {
  return value.trim().normalize("NFKC");
}

function hydrateTag(tag: StoredBookmarkTag): BookmarkTag {
  const name = displayTagName(tag.name);
  return { ...tag, name, normalizedName: normalizeTagName(name) };
}

function assertTagName(name: string): { displayName: string; normalizedName: string } {
  const displayName = displayTagName(name);
  const normalizedName = normalizeTagName(name);
  if (displayName.length === 0) throw new RangeError("Tag names cannot be empty.");
  if (displayName.length > MAX_TAG_NAME_LENGTH) {
    throw new RangeError(`Tag names cannot exceed ${MAX_TAG_NAME_LENGTH} characters.`);
  }
  return { displayName, normalizedName };
}

function sortedTags(tags: BookmarkTag[]): BookmarkTag[] {
  return tags.sort((left, right) =>
    left.normalizedName === right.normalizedName
      ? left.id.localeCompare(right.id)
      : left.normalizedName.localeCompare(right.normalizedName, "und"),
  );
}

export class TagRepository {
  private readonly connection: BookmarkDatabase;
  private readonly createId: () => string;
  private readonly now: () => Date;

  constructor(databaseName = "bookmark-x", options: TagRepositoryOptions = {}) {
    this.connection = new BookmarkDatabase(databaseName);
    this.createId = options.createId ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
  }

  async list(): Promise<BookmarkTag[]> {
    const database = await this.connection.open();
    const transaction = database.transaction(TAGS_STORE, "readonly");
    const storedTags = await requestAsPromise(
      transaction.objectStore(TAGS_STORE).getAll() as IDBRequest<StoredBookmarkTag[]>,
    );
    await transactionDone(transaction);
    return sortedTags(storedTags.map(hydrateTag));
  }

  async add(bookmarkId: string, name: string): Promise<TagAssignment> {
    const { displayName, normalizedName } = assertTagName(name);
    const database = await this.connection.open();
    const transaction = database.transaction(
      [BOOKMARKS_STORE, TAGS_STORE],
      "readwrite",
    );
    const bookmarks = transaction.objectStore(BOOKMARKS_STORE);
    const tags = transaction.objectStore(TAGS_STORE);
    const bookmark = await requestAsPromise(
      bookmarks.get(bookmarkId) as IDBRequest<BookmarkRecord | undefined>,
    );
    if (bookmark === undefined) {
      transaction.abort();
      await transactionDone(transaction).catch(() => undefined);
      throw new Error(`Bookmark ${bookmarkId} was not found.`);
    }

    const existingTags = await requestAsPromise(
      tags.getAll() as IDBRequest<StoredBookmarkTag[]>,
    );
    const storedTag = existingTags.find(
      (candidate) => normalizeTagName(candidate.name) === normalizedName,
    );
    let tag = storedTag === undefined ? undefined : hydrateTag(storedTag);
    if (tag === undefined) {
      tag = { id: this.createId(), name: displayName, normalizedName };
      tags.add(tag);
    } else if (
      storedTag?.name !== tag.name ||
      storedTag.normalizedName !== tag.normalizedName
    ) {
      tags.put(tag);
    }

    const updated = bookmark.tagIds.includes(tag.id)
      ? bookmark
      : {
          ...bookmark,
          tagIds: [...bookmark.tagIds, tag.id],
          metadataUpdatedAt: this.now().toISOString(),
        };
    if (updated !== bookmark) bookmarks.put(updated);
    await transactionDone(transaction);
    return { bookmark: updated, tag };
  }

  async remove(bookmarkId: string, tagId: string): Promise<BookmarkRecord> {
    const database = await this.connection.open();
    const transaction = database.transaction(BOOKMARKS_STORE, "readwrite");
    const bookmarks = transaction.objectStore(BOOKMARKS_STORE);
    const bookmark = await requestAsPromise(
      bookmarks.get(bookmarkId) as IDBRequest<BookmarkRecord | undefined>,
    );
    if (bookmark === undefined) {
      transaction.abort();
      await transactionDone(transaction).catch(() => undefined);
      throw new Error(`Bookmark ${bookmarkId} was not found.`);
    }
    if (!bookmark.tagIds.includes(tagId)) {
      await transactionDone(transaction);
      return bookmark;
    }
    const updated: BookmarkRecord = {
      ...bookmark,
      tagIds: bookmark.tagIds.filter((id) => id !== tagId),
      metadataUpdatedAt: this.now().toISOString(),
    };
    bookmarks.put(updated);
    await transactionDone(transaction);
    return updated;
  }
}
