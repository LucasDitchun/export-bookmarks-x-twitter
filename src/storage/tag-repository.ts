import type { BookmarkRecord, BookmarkTag } from "../domain/types";
import {
  BOOKMARKS_STORE,
  BOOKMARK_TAG_INDEX,
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
    return sortedTags(
      storedTags.filter((tag) => tag.deletedAt === undefined).map(hydrateTag),
    );
  }

  async listDeleted(): Promise<BookmarkTag[]> {
    const database = await this.connection.open();
    const transaction = database.transaction(TAGS_STORE, "readonly");
    const storedTags = await requestAsPromise(
      transaction.objectStore(TAGS_STORE).getAll() as IDBRequest<StoredBookmarkTag[]>,
    );
    await transactionDone(transaction);
    return sortedTags(
      storedTags.filter((tag) => tag.deletedAt !== undefined).map(hydrateTag),
    );
  }

  async usage(): Promise<Record<string, number>> {
    const database = await this.connection.open();
    const transaction = database.transaction(BOOKMARKS_STORE, "readonly");
    const bookmarks = await requestAsPromise(
      transaction.objectStore(BOOKMARKS_STORE).getAll() as IDBRequest<BookmarkRecord[]>,
    );
    await transactionDone(transaction);
    const usage: Record<string, number> = {};
    for (const bookmark of bookmarks) {
      for (const tagId of new Set(bookmark.tagIds)) {
        usage[tagId] = (usage[tagId] ?? 0) + 1;
      }
    }
    return usage;
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
      (candidate) =>
        candidate.deletedAt === undefined &&
        normalizeTagName(candidate.name) === normalizedName,
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

  async rename(id: string, name: string): Promise<BookmarkTag> {
    const { displayName, normalizedName } = assertTagName(name);
    const database = await this.connection.open();
    const transaction = database.transaction(TAGS_STORE, "readwrite");
    const store = transaction.objectStore(TAGS_STORE);
    const tags = await requestAsPromise(
      store.getAll() as IDBRequest<StoredBookmarkTag[]>,
    );
    const current = tags.find((tag) => tag.id === id && tag.deletedAt === undefined);
    if (!current) {
      transaction.abort();
      throw new Error(`Tag ${id} was not found.`);
    }
    if (
      tags.some(
        (tag) =>
          tag.id !== id &&
          tag.deletedAt === undefined &&
          normalizeTagName(tag.name) === normalizedName,
      )
    ) {
      transaction.abort();
      throw new Error("A tag with this name already exists.");
    }
    const updated: BookmarkTag = { id, name: displayName, normalizedName };
    store.put(updated);
    await transactionDone(transaction);
    return updated;
  }

  async delete(id: string): Promise<{
    deletedTagId: string;
    preservedBookmarkCount: number;
  }> {
    const database = await this.connection.open();
    const transaction = database.transaction(
      [TAGS_STORE, BOOKMARKS_STORE],
      "readwrite",
    );
    const tagStore = transaction.objectStore(TAGS_STORE);
    const bookmarkStore = transaction.objectStore(BOOKMARKS_STORE);
    const [tag, preservedBookmarkCount] = await Promise.all([
      requestAsPromise(tagStore.get(id) as IDBRequest<StoredBookmarkTag | undefined>),
      requestAsPromise(
        bookmarkStore.index(BOOKMARK_TAG_INDEX).count(IDBKeyRange.only(id)),
      ),
    ]);
    if (!tag || tag.deletedAt !== undefined) {
      transaction.abort();
      throw new Error(`Tag ${id} was not found.`);
    }
    const timestamp = this.now().toISOString();
    tagStore.put({ ...tag, deletedAt: timestamp });
    await transactionDone(transaction);
    return { deletedTagId: id, preservedBookmarkCount };
  }

  async restore(id: string): Promise<BookmarkTag> {
    const database = await this.connection.open();
    const transaction = database.transaction(TAGS_STORE, "readwrite");
    const store = transaction.objectStore(TAGS_STORE);
    const tags = await requestAsPromise(
      store.getAll() as IDBRequest<StoredBookmarkTag[]>,
    );
    const deleted = tags.find((tag) => tag.id === id && tag.deletedAt !== undefined);
    if (!deleted) {
      transaction.abort();
      throw new Error(`Deleted tag ${id} was not found.`);
    }
    const restored = hydrateTag(deleted);
    if (
      tags.some(
        (tag) =>
          tag.id !== id &&
          tag.deletedAt === undefined &&
          normalizeTagName(tag.name) === restored.normalizedName,
      )
    ) {
      transaction.abort();
      throw new Error("An active tag with this name already exists.");
    }
    const active: BookmarkTag = {
      id: restored.id,
      name: restored.name,
      normalizedName: restored.normalizedName,
    };
    store.put(active);
    await transactionDone(transaction);
    return active;
  }
}
