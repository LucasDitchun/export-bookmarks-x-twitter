import { describe, expect, it } from "vitest";

import {
  buildBookmarkExport,
  ExportValidationError,
  type BookmarkExportOptions,
  type ExportLibrarySnapshot,
} from "./export-bookmarks";
import type { BookmarkRecord } from "./types";

function bookmark(id: string, overrides: Partial<BookmarkRecord> = {}): BookmarkRecord {
  return {
    id,
    text: `Post ${id}`,
    url: `https://x.com/person/status/${id}`,
    author: { id: "author", username: "person", name: "Person" },
    postCreatedAt: `2026-08-0${id}T10:00:00.000Z`,
    media: { images: [], videos: [] },
    note: "",
    folderId: null,
    tagIds: [],
    firstSavedAt: `2026-08-0${id}T11:00:00.000Z`,
    lastSeenAt: `2026-08-0${id}T12:00:00.000Z`,
    archivedAt: null,
    metadataUpdatedAt: `2026-08-0${id}T12:00:00.000Z`,
    status: "current",
    ...overrides,
  };
}

const allFields = {
  url: true,
  text: true,
  author: true,
  postDate: true,
  note: true,
  breadcrumb: true,
  tags: true,
  images: true,
  videos: true,
  firstSavedAt: true,
  lastSeenAt: true,
} as const;

function options(
  overrides: Partial<BookmarkExportOptions> = {},
): BookmarkExportOptions {
  return {
    format: "txt",
    locale: "en",
    folderId: null,
    tagIds: [],
    includeArchived: false,
    fields: allFields,
    ...overrides,
  };
}

function library(
  bookmarks: BookmarkRecord[],
  overrides: Partial<ExportLibrarySnapshot> = {},
): ExportLibrarySnapshot {
  return {
    bookmarks,
    folders: [],
    tags: [],
    ...overrides,
  };
}

describe("buildBookmarkExport", () => {
  it.each([
    ["en", "BOOKMARK X ARCHIVE"],
    ["pt_BR", "ARQUIVO BOOKMARK X"],
    ["ja", "BOOKMARK X アーカイブ"],
    ["es", "ARCHIVO BOOKMARK X"],
    ["zh_CN", "BOOKMARK X 存档"],
    ["de", "BOOKMARK-X-ARCHIV"],
    ["fr", "ARCHIVE BOOKMARK X"],
    ["it", "ARCHIVIO BOOKMARK X"],
  ] as const)("localizes TXT headers for %s", (locale, title) => {
    expect(buildBookmarkExport(library([]), options({ locale }))).toMatch(
      new RegExp(`^\\uFEFF${title}`),
    );
  });

  it("combines a folder subtree with tags using folder AND (tag OR tag)", () => {
    const snapshot = library(
      [
        bookmark("1", { folderId: "child", tagIds: ["design"] }),
        bookmark("2", { folderId: "grandchild", tagIds: ["research"] }),
        bookmark("3", { folderId: "child", tagIds: ["unselected"] }),
        bookmark("4", { folderId: "elsewhere", tagIds: ["design"] }),
      ],
      {
        folders: [
          { id: "root", name: "Work", parentId: null },
          { id: "child", name: "Reading", parentId: "root" },
          { id: "grandchild", name: "AI", parentId: "child" },
          { id: "elsewhere", name: "Personal", parentId: null },
        ],
        tags: [
          { id: "design", name: "Design", normalizedName: "design" },
          { id: "research", name: "Research", normalizedName: "research" },
          { id: "unselected", name: "Other", normalizedName: "other" },
        ],
      },
    );

    const result = buildBookmarkExport(
      snapshot,
      options({
        folderId: "root",
        tagIds: ["design", "research"],
        fields: { ...allFields, text: false },
      }),
    );

    expect(result).toContain("https://x.com/person/status/1");
    expect(result).toContain("https://x.com/person/status/2");
    expect(result).not.toContain("https://x.com/person/status/3");
    expect(result).not.toContain("https://x.com/person/status/4");
    expect(result).toContain("Folder: Work › Reading › AI");
  });

  it("excludes archived bookmarks unless the filter includes them", () => {
    const snapshot = library([
      bookmark("1"),
      bookmark("2", {
        status: "archived",
        archivedAt: "2026-08-05T00:00:00.000Z",
      }),
    ]);

    expect(buildBookmarkExport(snapshot, options())).not.toContain("status/2");
    expect(buildBookmarkExport(snapshot, options({ includeArchived: true }))).toContain(
      "status/2",
    );
  });

  it("rejects an export with zero enabled fields", () => {
    expect(() =>
      buildBookmarkExport(
        library([bookmark("1")]),
        options({
          fields: Object.fromEntries(
            Object.keys(allFields).map((key) => [key, false]),
          ) as unknown as BookmarkExportOptions["fields"],
        }),
      ),
    ).toThrow(ExportValidationError);
  });

  it("escapes unsafe Markdown, preserves Unicode, and emits deterministic output", () => {
    const unsafe = bookmark("1", {
      text: "# heading\n<script>alert(1)</script>\n[click](javascript:alert(1))",
      note: "Remember *why* | soon",
      author: {
        id: "author",
        username: "person",
        name: "A [name] <img src=x onerror=alert(1)>",
      },
      tagIds: ["tag"],
    });
    const snapshot = library([unsafe], {
      tags: [{ id: "tag", name: "AI | 日本語", normalizedName: "ai | 日本語" }],
    });
    const exportOptions = options({ format: "md" });

    const first = buildBookmarkExport(snapshot, exportOptions);
    const second = buildBookmarkExport(snapshot, exportOptions);

    expect(first).toBe(second);
    expect(first).toContain("# BOOKMARK X ARCHIVE");
    expect(first).toContain("日本語");
    expect(first).not.toContain("<script>");
    expect(first).not.toContain("<img");
    expect(first).not.toContain("[click](javascript:");
    expect(first).toContain("\\# heading");
  });

  it("exports image URLs and canonical video post URLs, never thumbnails or MP4/CDN URLs", () => {
    const result = buildBookmarkExport(
      library([
        bookmark("1", {
          media: {
            images: [
              "https://pbs.twimg.com/media/example.jpg",
              "https://pbs.twimg.com/media/example.jpg",
              "javascript:alert(1)",
            ],
            videos: [
              {
                postUrl: "https://x.com/person/status/1",
                thumbnailUrl: "https://pbs.twimg.com/ext_tw_video_thumb/temp.jpg",
              },
            ],
          },
        }),
      ]),
      options({ format: "md" }),
    );

    expect(result.match(/example\.jpg/g)).toHaveLength(1);
    expect(result).toContain("https://x.com/person/status/1");
    expect(result).not.toContain("ext_tw_video_thumb");
    expect(result).not.toMatch(/\.mp4/i);
    expect(result).not.toContain("<javascript:");
  });

  it("deduplicates bookmarks and orders newest posts first with a stable id tie-break", () => {
    const older = bookmark("1", { postCreatedAt: "2026-08-01T00:00:00.000Z" });
    const newer = bookmark("2", { postCreatedAt: "2026-08-02T00:00:00.000Z" });
    const result = buildBookmarkExport(
      library([older, newer, structuredClone(older)]),
      options({ fields: { ...allFields, url: true, text: false } }),
    );

    expect(result.match(/status\/1/g)).toHaveLength(1);
    expect(result.indexOf("status/2")).toBeLessThan(result.indexOf("status/1"));
  });

  it("builds a deduplicated export for more than one thousand bookmarks", () => {
    const bookmarks = Array.from({ length: 1_250 }, (_, index) => {
      const id = String(index + 1);
      return bookmark(id, { postCreatedAt: "2026-08-01T00:00:00.000Z" });
    });
    const result = buildBookmarkExport(
      library([...bookmarks, ...bookmarks.slice(0, 25)]),
      options({
        fields: {
          ...Object.fromEntries(Object.keys(allFields).map((key) => [key, false])),
          url: true,
        } as BookmarkExportOptions["fields"],
      }),
    );

    expect(result).toContain("1250 items");
    expect(result.match(/https:\/\/x\.com\/person\/status\//g)).toHaveLength(1_250);
  });

  it("removes disabled fields and never exposes the internal status", () => {
    const result = buildBookmarkExport(
      library([
        bookmark("1", {
          text: "hidden text",
          note: "hidden note",
          status: "archived",
          archivedAt: "2026-08-08T00:00:00.000Z",
        }),
      ]),
      options({
        includeArchived: true,
        fields: { ...allFields, text: false, note: false },
      }),
    );

    expect(result).not.toContain("hidden text");
    expect(result).not.toContain("hidden note");
    expect(result).not.toContain("Status:");
    expect(result).not.toContain("Archived");
  });
});
