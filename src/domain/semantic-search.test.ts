import { describe, expect, it } from "vitest";

import type { BookmarkRecord } from "./types";
import {
  buildSemanticPassage,
  reciprocalRankFusion,
  semanticDocumentFingerprint,
} from "./semantic-search";

const bookmark = (id: string, text = `Post ${id}`): BookmarkRecord => ({
  id,
  url: `https://x.com/person/status/${id}`,
  text,
  author: { id: "ada", name: "Ada Lovelace", username: "ada" },
  postCreatedAt: "2026-08-01T00:00:00.000Z",
  firstSavedAt: `2026-08-0${id}T00:00:00.000Z`,
  lastSeenAt: `2026-08-0${id}T00:00:00.000Z`,
  archivedAt: null,
  metadataUpdatedAt: `2026-08-0${id}T00:00:00.000Z`,
  status: "current",
  note: id === "1" ? "Read this for the search design" : "",
  tagIds: [],
  folderId: null,
  media: { images: [], videos: [] },
});

describe("semantic search domain", () => {
  it("builds one local passage from post, author, note, tags, and folder path", () => {
    expect(
      buildSemanticPassage({
        bookmark: bookmark("1", "Multilingual retrieval"),
        tagNames: ["Research", "Search"],
        folderBreadcrumb: ["Engineering", "AI"],
      }),
    ).toBe(
      "passage: Multilingual retrieval\nAuthor: Ada Lovelace (@ada)\nNote: Read this for the search design\nTags: Research, Search\nFolder: Engineering / AI",
    );
  });

  it("fingerprints every semantic field deterministically", async () => {
    const document = {
      bookmark: bookmark("1"),
      tagNames: ["Research"],
      folderBreadcrumb: ["AI"],
    };
    const first = await semanticDocumentFingerprint(document);
    const second = await semanticDocumentFingerprint(structuredClone(document));

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    await expect(
      semanticDocumentFingerprint({ ...document, tagNames: ["Different"] }),
    ).resolves.not.toBe(first);
    await expect(
      semanticDocumentFingerprint({
        ...document,
        bookmark: {
          ...document.bookmark,
          status: "archived",
          archivedAt: "2026-08-09T12:00:00.000Z",
        },
      }),
    ).resolves.not.toBe(first);
  });

  it("combines lexical and semantic rankings with deterministic RRF ties", () => {
    const records = [bookmark("1"), bookmark("2"), bookmark("3")];
    const result = reciprocalRankFusion(
      [records[0]!, records[1]!],
      [records[2]!, records[1]!],
      60,
    );

    expect(result.map(({ bookmark }) => bookmark.id)).toEqual(["2", "1", "3"]);
    expect(result[0]!.sources).toEqual({ lexical: true, semantic: true });
    expect(result[1]!.sources).toEqual({ lexical: true, semantic: false });
    expect(result[2]!.sources).toEqual({ lexical: false, semantic: true });
  });

  it("deduplicates IDs and uses lexical rank then ID for exact score ties", () => {
    const duplicate = { ...bookmark("1"), text: "newer snapshot" };
    const result = reciprocalRankFusion(
      [bookmark("2"), bookmark("1")],
      [bookmark("1"), duplicate, bookmark("2")],
      1,
    );

    expect(result.map(({ bookmark }) => bookmark.id)).toEqual(["2", "1"]);
    expect(result[1]!.bookmark.text).toBe("Post 1");
  });
});
