import { describe, expect, it } from "vitest";

import {
  isBookmarkId,
  isBookmarksUrl,
  isFolderName,
  isLocalEntityId,
  isRecord,
  isTagName,
  isXUrl,
} from "./request-guards";

describe("background request guards", () => {
  it("accepts only plain records and canonical identifiers", () => {
    expect(isRecord({ type: "GET_STATUS" })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isBookmarkId("123456")).toBe(true);
    expect(isBookmarkId("post-123")).toBe(false);
    expect(isLocalEntityId("tag_research-1")).toBe(true);
    expect(isLocalEntityId("tag/research")).toBe(false);
  });

  it("rejects empty, oversized, and control-character names", () => {
    expect(isFolderName(" Research ")).toBe(true);
    expect(isFolderName(`Unsafe\nname`)).toBe(false);
    expect(isFolderName("x".repeat(101))).toBe(false);
    expect(isTagName("Accessibility")).toBe(true);
    expect(isTagName("x".repeat(51))).toBe(false);
    expect(isTagName("\u0000tag")).toBe(false);
  });

  it("recognizes only X pages and the dedicated bookmarks route", () => {
    expect(isXUrl("https://x.com/home")).toBe(true);
    expect(isXUrl("https://example.com/x.com")).toBe(false);
    expect(isBookmarksUrl("https://x.com/i/bookmarks")).toBe(true);
    expect(isBookmarksUrl("https://www.x.com/i/bookmarks/folder/1")).toBe(true);
    expect(isBookmarksUrl("https://x.com/home")).toBe(false);
    expect(isBookmarksUrl("not a URL")).toBe(false);
  });
});
