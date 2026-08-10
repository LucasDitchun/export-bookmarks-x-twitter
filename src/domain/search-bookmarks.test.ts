import { describe, expect, it } from "vitest";

import type { BookmarkRecord } from "./types";
import { searchBookmarkDocuments } from "./search-bookmarks";

function bookmark(id: string, overrides: Partial<BookmarkRecord> = {}): BookmarkRecord {
  return {
    id,
    text: `Post ${id}`,
    url: `https://x.com/person/status/${id}`,
    author: { id: "person", username: "person", name: "Person" },
    postCreatedAt: "2026-01-01T00:00:00.000Z",
    media: { images: [], videos: [] },
    note: "",
    folderId: null,
    tagIds: [],
    firstSavedAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    metadataUpdatedAt: "2026-01-01T00:00:00.000Z",
    status: "current",
    ...overrides,
  };
}

describe("searchBookmarkDocuments", () => {
  it("matches bookmark text without case or accent differences", () => {
    const result = searchBookmarkDocuments(
      [
        {
          bookmark: bookmark("1", { text: "Café com boas ideias" }),
          tagNames: [],
          folderBreadcrumb: [],
        },
      ],
      "CAFE",
      "current",
    );

    expect(result.map(({ bookmark: item }) => item.id)).toEqual(["1"]);
  });

  it("matches every searchable metadata surface and all query terms", () => {
    const documents = [
      {
        bookmark: bookmark("1", {
          author: { id: "a", username: "ada_dev", name: "Ada Lovelace" },
          note: "Revisit the analytical engine example",
        }),
        tagNames: ["Computação"],
        folderBreadcrumb: ["Research", "History"],
      },
    ];

    for (const query of [
      "ada_dev",
      "lovelace",
      "analytical engine",
      "computacao",
      "research history",
    ]) {
      expect(searchBookmarkDocuments(documents, query, "current")).toHaveLength(1);
    }
    expect(searchBookmarkDocuments(documents, "ada missing", "current")).toEqual([]);
  });

  it.each([
    ["en", "Architecture patterns", "architecture"],
    ["pt_BR", "Acessibilidade semântica", "acessibilidade semantica"],
    ["ja", "機械学習の入門", "機械学習"],
    ["es", "Diseño accesible", "diseno accesible"],
    ["zh_CN", "本地语义搜索", "语义搜索"],
    ["de", "Überblick zur Datenbank", "uberblick datenbank"],
    ["fr", "Résumé de recherche", "resume recherche"],
    ["it", "Organizzazione locale", "organizzazione"],
  ] as const)(
    "matches a deterministic %s query without downloading a model",
    (locale, text, query) => {
      const result = searchBookmarkDocuments(
        [
          {
            bookmark: bookmark(locale, { text }),
            tagNames: [],
            folderBreadcrumb: [],
          },
        ],
        query,
        "current",
      );

      expect(result.map(({ bookmark: item }) => item.id)).toEqual([locale]);
    },
  );

  it("respects library views and orders relevant ties deterministically", () => {
    const documents = [
      {
        bookmark: bookmark("100", {
          text: "TypeScript",
          firstSavedAt: "2026-03-01T00:00:00.000Z",
        }),
        tagNames: [],
        folderBreadcrumb: [],
      },
      {
        bookmark: bookmark("200", {
          text: "Language notes",
          note: "TypeScript",
          firstSavedAt: "2026-04-01T00:00:00.000Z",
        }),
        tagNames: [],
        folderBreadcrumb: [],
      },
      {
        bookmark: bookmark("300", {
          text: "TypeScript",
          status: "archived",
          archivedAt: "2026-05-01T00:00:00.000Z",
        }),
        tagNames: [],
        folderBreadcrumb: [],
      },
      {
        bookmark: bookmark("400", {
          text: "TypeScript",
          note: "Organized",
          folderId: "folder-1",
          tagIds: ["tag-1"],
          firstSavedAt: "2026-05-01T00:00:00.000Z",
        }),
        tagNames: ["Language"],
        folderBreadcrumb: ["Development"],
      },
    ];

    expect(
      searchBookmarkDocuments(documents, "typescript", "current").map(
        ({ bookmark: item }) => item.id,
      ),
    ).toEqual(["400", "100", "200"]);
    expect(
      searchBookmarkDocuments(documents, "typescript", "archived").map(
        ({ bookmark: item }) => item.id,
      ),
    ).toEqual(["300"]);
    expect(
      searchBookmarkDocuments(documents, "typescript", "inbox").map(
        ({ bookmark: item }) => item.id,
      ),
    ).toEqual(["100", "200"]);
  });
});
