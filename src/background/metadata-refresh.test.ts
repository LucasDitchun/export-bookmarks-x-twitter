import { describe, expect, it } from "vitest";

import { metadataRefreshRequest } from "./metadata-refresh";

describe("metadataRefreshRequest", () => {
  it("targets the affected bookmark for direct metadata and live changes", () => {
    expect(
      metadataRefreshRequest({
        type: "SAVE_BOOKMARK_NOTE",
        payload: { id: "123", note: "context" },
      }),
    ).toEqual({ type: "REFRESH_BOOKMARK_METADATA", bookmarkIds: ["123"] });
    expect(
      metadataRefreshRequest({
        type: "ASSIGN_BOOKMARK_FOLDER",
        payload: { bookmarkId: "456", folderId: null },
      }),
    ).toEqual({ type: "REFRESH_BOOKMARK_METADATA", bookmarkIds: ["456"] });
    expect(
      metadataRefreshRequest({
        type: "LIVE_BOOKMARK_CONFIRMED",
        bookmark: { id: "789" },
      }),
    ).toEqual({ type: "REFRESH_BOOKMARK_METADATA", bookmarkIds: ["789"] });
  });

  it("deduplicates scrape batches and refreshes all for global changes", () => {
    expect(
      metadataRefreshRequest({
        type: "SCRAPE_BATCH",
        bookmarks: [{ id: "123" }, { id: "123" }, { id: "456" }],
      }),
    ).toEqual({
      type: "REFRESH_BOOKMARK_METADATA",
      bookmarkIds: ["123", "456"],
    });
    expect(metadataRefreshRequest({ type: "SAVE_SETTINGS" })).toEqual({
      type: "REFRESH_BOOKMARK_METADATA",
    });
    expect(metadataRefreshRequest({ type: "DELETE_FOLDER" })).toEqual({
      type: "REFRESH_BOOKMARK_METADATA",
    });
    expect(metadataRefreshRequest({ type: "RESTORE_TAG" })).toEqual({
      type: "REFRESH_BOOKMARK_METADATA",
    });
    expect(metadataRefreshRequest({ type: "RESTORE_FOLDER" })).toEqual({
      type: "REFRESH_BOOKMARK_METADATA",
    });
  });

  it("ignores malformed, unrelated, and failed identifiers", () => {
    expect(metadataRefreshRequest(null)).toBeNull();
    expect(metadataRefreshRequest({ type: "GET_STATUS" })).toBeNull();
    expect(
      metadataRefreshRequest({
        type: "SAVE_BOOKMARK_NOTE",
        payload: { id: "javascript:alert(1)" },
      }),
    ).toBeNull();
    expect(metadataRefreshRequest({ type: "SCRAPE_BATCH", bookmarks: [] })).toBeNull();
  });
});
