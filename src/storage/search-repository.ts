import {
  createBookmarkSearchIndex,
  MAX_SEARCH_QUERY_LENGTH,
  normalizeSearchText,
  searchBookmarkIndex,
  type BookmarkSearchDocument,
  type BookmarkSearchIndex,
  type SearchBookmarkView,
} from "../domain/search-bookmarks";
import type { BookmarkRecord, BookmarkTag, FolderRecord } from "../domain/types";
import {
  BOOKMARKS_STORE,
  BookmarkDatabase,
  FOLDERS_STORE,
  requestAsPromise,
  TAGS_STORE,
  transactionDone,
} from "./bookmark-database";

const MAX_SEARCH_PAGE_SIZE = 100;
export { MAX_SEARCH_QUERY_LENGTH } from "../domain/search-bookmarks";

export interface BookmarkSearchOptions {
  query: string;
  view: SearchBookmarkView;
  cursor?: string;
  limit: number;
}

export interface BookmarkSearchPage {
  items: BookmarkRecord[];
  total: number;
  nextCursor: string | null;
}

interface SearchCursor {
  offset: number;
  query: string;
  view: SearchBookmarkView;
}

function encodeCursor(cursor: SearchCursor): string {
  return btoa(encodeURIComponent(JSON.stringify({ v: 1, ...cursor })));
}

function decodeCursor(
  value: string,
  query: string,
  view: SearchBookmarkView,
): SearchCursor {
  try {
    const cursor = JSON.parse(decodeURIComponent(atob(value))) as Record<
      string,
      unknown
    >;
    if (
      cursor.v !== 1 ||
      cursor.query !== query ||
      cursor.view !== view ||
      !Number.isSafeInteger(cursor.offset) ||
      (cursor.offset as number) < 1
    ) {
      throw new Error("Unexpected cursor shape.");
    }
    return { query, view, offset: cursor.offset as number };
  } catch {
    throw new Error("Invalid bookmark search cursor.");
  }
}

function createFolderBreadcrumbResolver(
  folders: readonly FolderRecord[],
): (folderId: string | null) => string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const cache = new Map<string, string[]>();
  return (folderId) => {
    if (folderId === null) return [];
    const cached = cache.get(folderId);
    if (cached !== undefined) return cached;
    const names: string[] = [];
    const visited = new Set<string>();
    let current = byId.get(folderId);
    while (current !== undefined && !visited.has(current.id)) {
      visited.add(current.id);
      names.unshift(current.name);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }
    cache.set(folderId, names);
    return names;
  };
}

function createDocuments(
  bookmarks: readonly BookmarkRecord[],
  folders: readonly FolderRecord[],
  tags: readonly BookmarkTag[],
): BookmarkSearchDocument[] {
  const tagById = new Map(tags.map((tag) => [tag.id, tag.name]));
  const folderBreadcrumb = createFolderBreadcrumbResolver(folders);
  return bookmarks.map((bookmark) => ({
    bookmark,
    tagNames: bookmark.tagIds.flatMap((id) => {
      const name = tagById.get(id);
      return name === undefined ? [] : [name];
    }),
    folderBreadcrumb: folderBreadcrumb(bookmark.folderId),
  }));
}

export class SearchRepository {
  private readonly connection: BookmarkDatabase;
  private indexPromise: Promise<BookmarkSearchIndex> | null = null;

  constructor(databaseName = "bookmark-x") {
    this.connection = new BookmarkDatabase(databaseName);
  }

  invalidate(): void {
    this.indexPromise = null;
  }

  async search(options: BookmarkSearchOptions): Promise<BookmarkSearchPage> {
    if (
      !Number.isSafeInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > MAX_SEARCH_PAGE_SIZE
    ) {
      throw new RangeError(
        `Bookmark search limit must be between 1 and ${MAX_SEARCH_PAGE_SIZE}.`,
      );
    }
    if (options.query.length > MAX_SEARCH_QUERY_LENGTH) {
      throw new RangeError(
        `Bookmark search queries cannot exceed ${MAX_SEARCH_QUERY_LENGTH} characters.`,
      );
    }

    const query = normalizeSearchText(options.query);
    if (query.length === 0) return { items: [], total: 0, nextCursor: null };
    const offset =
      options.cursor === undefined
        ? 0
        : decodeCursor(options.cursor, query, options.view).offset;
    const hits = searchBookmarkIndex(await this.getIndex(), query, options.view);
    const nextOffset = offset + options.limit;
    return {
      items: hits.slice(offset, nextOffset).map(({ bookmark }) => bookmark),
      total: hits.length,
      nextCursor:
        nextOffset < hits.length
          ? encodeCursor({ offset: nextOffset, query, view: options.view })
          : null,
    };
  }

  private getIndex(): Promise<BookmarkSearchIndex> {
    this.indexPromise ??= this.loadIndex();
    return this.indexPromise;
  }

  private async loadIndex(): Promise<BookmarkSearchIndex> {
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
    return createBookmarkSearchIndex(createDocuments(bookmarks, folders, tags));
  }
}
