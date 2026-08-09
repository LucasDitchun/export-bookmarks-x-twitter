import type { ExportLibrarySnapshot } from "../domain/export-bookmarks";
import type { BookmarkRecord, BookmarkTag, FolderRecord } from "../domain/types";
import { sortFolders } from "../domain/folder-tree";
import { normalizeTagName } from "./tag-repository";
import {
  BOOKMARKS_STORE,
  BookmarkDatabase,
  FOLDERS_STORE,
  requestAsPromise,
  TAGS_STORE,
  transactionDone,
} from "./bookmark-database";

/** Reads all logical export data from one readonly IndexedDB transaction. */
export class ExportRepository {
  private readonly connection: BookmarkDatabase;

  constructor(databaseName = "bookmark-x") {
    this.connection = new BookmarkDatabase(databaseName);
  }

  async snapshot(): Promise<ExportLibrarySnapshot> {
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
    const canonicalTags = tags.map((tag) => ({
      ...tag,
      normalizedName: tag.normalizedName || normalizeTagName(tag.name),
    }));
    return {
      bookmarks,
      folders: sortFolders(folders),
      tags: canonicalTags.sort((left, right) =>
        left.normalizedName === right.normalizedName
          ? left.id.localeCompare(right.id)
          : left.normalizedName.localeCompare(right.normalizedName, "und"),
      ),
    };
  }
}
