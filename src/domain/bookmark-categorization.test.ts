import { describe, expect, it } from "vitest";

import type { BookmarkRecord } from "./types";
import { isBookmarkCategorized } from "./bookmark-categorization";

const bookmark = (overrides: Partial<BookmarkRecord> = {}): BookmarkRecord => ({
  id: "123",
  text: "Local knowledge",
  url: "https://x.com/person/status/123",
  author: { id: "person", username: "person", name: "Person" },
  postCreatedAt: "2026-01-01T00:00:00.000Z",
  media: { images: [], videos: [] },
  note: "Why this matters",
  folderId: "folder-1",
  tagIds: ["tag-1"],
  firstSavedAt: "2026-01-01T00:00:00.000Z",
  lastSeenAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
  metadataUpdatedAt: "2026-01-01T00:00:00.000Z",
  status: "current",
  ...overrides,
});

describe("isBookmarkCategorized", () => {
  it("requires note, tags, and folder when their metadata fields are enabled", () => {
    const requirements = { note: true, tags: true, breadcrumb: true };

    expect(isBookmarkCategorized(bookmark(), requirements)).toBe(true);
    expect(isBookmarkCategorized(bookmark({ note: "  " }), requirements)).toBe(false);
    expect(isBookmarkCategorized(bookmark({ tagIds: [] }), requirements)).toBe(false);
    expect(isBookmarkCategorized(bookmark({ folderId: null }), requirements)).toBe(
      false,
    );
  });

  it("ignores each disabled metadata field and treats an empty requirement set as categorized", () => {
    const empty = bookmark({ note: "", tagIds: [], folderId: null });

    expect(
      isBookmarkCategorized(empty, { note: false, tags: false, breadcrumb: false }),
    ).toBe(true);
    expect(
      isBookmarkCategorized(empty, { note: true, tags: false, breadcrumb: false }),
    ).toBe(false);
    expect(
      isBookmarkCategorized(empty, { note: false, tags: true, breadcrumb: false }),
    ).toBe(false);
    expect(
      isBookmarkCategorized(empty, { note: false, tags: false, breadcrumb: true }),
    ).toBe(false);
  });
});
