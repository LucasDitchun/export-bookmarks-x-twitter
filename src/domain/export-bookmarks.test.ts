import { describe, expect, it } from "vitest";

import { exportBookmarks } from "./export-bookmarks";
import type { BookmarkRecord } from "./types";

describe("exportBookmarks", () => {
  it.each([
    ["en", "BOOKMARK X ARCHIVE"],
    ["pt_BR", "ARQUIVO BOOKMARK X"],
    ["ja", "BOOKMARK X アーカイブ"],
    ["es", "ARCHIVO BOOKMARK X"],
    ["zh_CN", "BOOKMARK X 存档"],
    ["de", "BOOKMARK-X-ARCHIV"],
    ["fr", "ARCHIVE BOOKMARK X"],
    ["it", "ARCHIVIO BOOKMARK X"],
  ] as const)("localizes full archive headers for %s", (locale, title) => {
    expect(exportBookmarks([], { format: "full", locale })).toMatch(
      new RegExp(`^\\uFEFF${title}`),
    );
  });

  it("exports canonical URLs from newest to oldest", () => {
    const bookmarks: BookmarkRecord[] = [
      {
        id: "100",
        text: "Older",
        url: "https://x.com/first/status/100",
        author: { id: "1", username: "first", name: "First" },
        postCreatedAt: "2024-01-01T10:00:00.000Z",
        folders: [],
        firstArchivedAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-01-01T00:00:00.000Z",
        isCurrent: true,
      },
      {
        id: "200",
        text: "Newer",
        url: "https://x.com/second/status/200",
        author: { id: "2", username: "second", name: "Second" },
        postCreatedAt: "2025-01-01T10:00:00.000Z",
        folders: [],
        firstArchivedAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-01-01T00:00:00.000Z",
        isCurrent: true,
      },
    ];

    expect(exportBookmarks(bookmarks, { format: "urls", locale: "en" })).toBe(
      "\uFEFFhttps://x.com/second/status/200\nhttps://x.com/first/status/100\n",
    );
  });

  it("renders a readable localized archive without changing source text", () => {
    const bookmark: BookmarkRecord = {
      id: "200",
      text: "A useful post\r\nwith two lines  ",
      url: "https://x.com/second/status/200",
      author: { id: "2", username: "second", name: "Second Author" },
      postCreatedAt: "2025-01-01T10:00:00.000Z",
      folders: [{ id: "folder-1", name: "Research" }],
      firstArchivedAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-02-01T00:00:00.000Z",
      isCurrent: false,
    };

    const exported = exportBookmarks([bookmark], {
      format: "full",
      locale: "en",
    });

    expect(exported).toContain("BOOKMARK X ARCHIVE\n1 item");
    expect(exported).toContain("@second — Second Author");
    expect(exported).toContain("Folder: Research");
    expect(exported).toContain("Status: Archived");
    expect(exported).toContain("A useful post\nwith two lines");
    expect(exported).not.toContain("\r");
  });
});
