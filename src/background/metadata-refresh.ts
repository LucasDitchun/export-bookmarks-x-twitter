import type { ContentControlRequest } from "../shared/protocol";

interface MetadataMutationMessage {
  type?: unknown;
  payload?: { id?: unknown; bookmarkId?: unknown };
  bookmark?: { id?: unknown };
  bookmarks?: Array<{ id?: unknown }>;
}

function validBookmarkId(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

export function metadataRefreshRequest(request: unknown): ContentControlRequest | null {
  if (typeof request !== "object" || request === null) return null;
  const message = request as MetadataMutationMessage;
  const id =
    typeof message.payload?.bookmarkId === "string"
      ? message.payload.bookmarkId
      : typeof message.payload?.id === "string"
        ? message.payload.id
        : typeof message.bookmark?.id === "string"
          ? message.bookmark.id
          : null;
  if (
    message.type === "SAVE_BOOKMARK_NOTE" ||
    message.type === "ADD_BOOKMARK_TAG" ||
    message.type === "REMOVE_BOOKMARK_TAG" ||
    message.type === "ASSIGN_BOOKMARK_FOLDER" ||
    message.type === "LIVE_BOOKMARK_CONFIRMED"
  ) {
    return validBookmarkId(id)
      ? { type: "REFRESH_BOOKMARK_METADATA", bookmarkIds: [id] }
      : null;
  }
  if (message.type === "SCRAPE_BATCH" && Array.isArray(message.bookmarks)) {
    const bookmarkIds = [
      ...new Set(
        message.bookmarks
          .map(({ id: bookmarkId }) => bookmarkId)
          .filter(validBookmarkId),
      ),
    ];
    return bookmarkIds.length
      ? { type: "REFRESH_BOOKMARK_METADATA", bookmarkIds }
      : null;
  }
  if (
    message.type === "SAVE_SETTINGS" ||
    message.type === "CREATE_FOLDER" ||
    message.type === "RENAME_TAG" ||
    message.type === "DELETE_TAG" ||
    message.type === "RESTORE_TAG" ||
    message.type === "RENAME_FOLDER" ||
    message.type === "DELETE_FOLDER" ||
    message.type === "RESTORE_FOLDER" ||
    message.type === "CLEAR_ARCHIVE" ||
    message.type === "RESTORE_BACKUP"
  ) {
    return { type: "REFRESH_BOOKMARK_METADATA" };
  }
  return null;
}
