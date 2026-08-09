import type { BookmarkRecord, BookmarkStatus } from "../domain/types";
import {
  BOOKMARKS_STORE,
  BookmarkDatabase,
  requestAsPromise,
  transactionDone,
} from "./bookmark-database";

export const MAX_BOOKMARK_NOTE_LENGTH = 20_000;
const MAX_PAGE_SIZE = 100;

export type BookmarkListView = "current" | "inbox" | "archived";

export interface BookmarkListOptions {
  view: BookmarkListView;
  cursor?: string;
  limit: number;
}

export interface BookmarkListPage {
  items: BookmarkRecord[];
  nextCursor: string | null;
}

export interface BookmarkRepositoryOptions {
  now?: () => Date;
}

interface DecodedCursor {
  firstSavedAt: string;
  id: string;
}

function encodeCursor(bookmark: BookmarkRecord): string {
  return btoa(
    JSON.stringify({
      v: 1,
      firstSavedAt: bookmark.firstSavedAt,
      id: bookmark.id,
    }),
  );
}

function decodeCursor(cursor: string): DecodedCursor {
  try {
    const value = JSON.parse(atob(cursor)) as Record<string, unknown>;
    if (
      value.v !== 1 ||
      typeof value.firstSavedAt !== "string" ||
      typeof value.id !== "string"
    ) {
      throw new Error("Unexpected cursor shape.");
    }
    return { firstSavedAt: value.firstSavedAt, id: value.id };
  } catch {
    throw new Error("Invalid bookmark cursor.");
  }
}

function isInboxBookmark(bookmark: BookmarkRecord): boolean {
  return (
    bookmark.status === "current" &&
    (bookmark.note.length === 0 ||
      bookmark.folderId === null ||
      bookmark.tagIds.length === 0)
  );
}

function statusForView(view: BookmarkListView): BookmarkStatus {
  return view === "archived" ? "archived" : "current";
}

function pageRange(status: BookmarkStatus, cursor: DecodedCursor | null): IDBKeyRange {
  const lower = [status, "", ""];
  if (cursor === null) {
    return IDBKeyRange.bound(lower, [status, "\uffff", "\uffff"]);
  }
  return IDBKeyRange.bound(
    lower,
    [status, cursor.firstSavedAt, cursor.id],
    false,
    true,
  );
}

function readPage(
  request: IDBRequest<IDBCursorWithValue | null>,
  matches: (bookmark: BookmarkRecord) => boolean,
  resultSize: number,
): Promise<BookmarkRecord[]> {
  return new Promise((resolve, reject) => {
    const items: BookmarkRecord[] = [];
    request.addEventListener("success", () => {
      const cursor = request.result;
      if (cursor === null || items.length === resultSize) {
        resolve(items);
        return;
      }
      const bookmark = cursor.value as BookmarkRecord;
      if (matches(bookmark)) items.push(bookmark);
      if (items.length === resultSize) resolve(items);
      else cursor.continue();
    });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new Error("Bookmark page query failed.")),
      { once: true },
    );
  });
}

export class BookmarkRepository {
  private readonly connection: BookmarkDatabase;
  private readonly now: () => Date;

  constructor(databaseName = "bookmark-x", options: BookmarkRepositoryOptions = {}) {
    this.connection = new BookmarkDatabase(databaseName);
    this.now = options.now ?? (() => new Date());
  }

  async list(options: BookmarkListOptions): Promise<BookmarkListPage> {
    if (
      !Number.isSafeInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > MAX_PAGE_SIZE
    ) {
      throw new RangeError(
        `Bookmark page limit must be between 1 and ${MAX_PAGE_SIZE}.`,
      );
    }

    const cursor = options.cursor === undefined ? null : decodeCursor(options.cursor);
    const status = statusForView(options.view);
    const database = await this.connection.open();
    const transaction = database.transaction(BOOKMARKS_STORE, "readonly");
    const index = transaction.objectStore(BOOKMARKS_STORE).index("byStatusSaved");
    const records = await readPage(
      index.openCursor(pageRange(status, cursor), "prev"),
      options.view === "inbox" ? isInboxBookmark : () => true,
      options.limit + 1,
    );
    await transactionDone(transaction);

    const hasNextPage = records.length > options.limit;
    const items = hasNextPage ? records.slice(0, options.limit) : records;
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasNextPage && last !== undefined ? encodeCursor(last) : null,
    };
  }

  async get(id: string): Promise<BookmarkRecord | null> {
    const database = await this.connection.open();
    const transaction = database.transaction(BOOKMARKS_STORE, "readonly");
    const result = await requestAsPromise(
      transaction.objectStore(BOOKMARKS_STORE).get(id) as IDBRequest<
        BookmarkRecord | undefined
      >,
    );
    await transactionDone(transaction);
    return result ?? null;
  }

  async getMany(ids: readonly string[]): Promise<BookmarkRecord[]> {
    if (ids.length === 0) return [];
    const database = await this.connection.open();
    const transaction = database.transaction(BOOKMARKS_STORE, "readonly");
    const store = transaction.objectStore(BOOKMARKS_STORE);
    const records = await Promise.all(
      [...new Set(ids)].map((id) =>
        requestAsPromise(store.get(id) as IDBRequest<BookmarkRecord | undefined>),
      ),
    );
    await transactionDone(transaction);
    return records.filter(
      (bookmark): bookmark is BookmarkRecord => bookmark !== undefined,
    );
  }

  async saveNote(id: string, note: string): Promise<BookmarkRecord> {
    if (note.length > MAX_BOOKMARK_NOTE_LENGTH) {
      throw new RangeError("Bookmark notes cannot exceed 20,000 characters.");
    }

    const database = await this.connection.open();
    const transaction = database.transaction(BOOKMARKS_STORE, "readwrite");
    const store = transaction.objectStore(BOOKMARKS_STORE);
    const existing = await requestAsPromise(
      store.get(id) as IDBRequest<BookmarkRecord | undefined>,
    );
    if (existing === undefined) {
      await transactionDone(transaction);
      throw new Error(`Bookmark ${id} was not found.`);
    }

    const updated: BookmarkRecord = {
      ...existing,
      note,
      metadataUpdatedAt: this.now().toISOString(),
    };
    store.put(updated);
    await transactionDone(transaction);
    return updated;
  }
}
