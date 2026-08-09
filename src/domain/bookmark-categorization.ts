import type { BookmarkRecord } from "./types";

export interface BookmarkCategorizationFields {
  breadcrumb: boolean;
  note: boolean;
  tags: boolean;
}

export const DEFAULT_BOOKMARK_CATEGORIZATION_FIELDS: Readonly<BookmarkCategorizationFields> =
  Object.freeze({
    breadcrumb: true,
    note: true,
    tags: true,
  });

/**
 * A disabled metadata field is also disabled as a categorization requirement.
 * The category indicator itself only controls visibility and is intentionally
 * not part of this calculation.
 */
export function isBookmarkCategorized(
  bookmark: Pick<BookmarkRecord, "folderId" | "note" | "tagIds">,
  fields: BookmarkCategorizationFields,
): boolean {
  return (
    (!fields.note || bookmark.note.trim().length > 0) &&
    (!fields.tags || bookmark.tagIds.length > 0) &&
    (!fields.breadcrumb || bookmark.folderId !== null)
  );
}
