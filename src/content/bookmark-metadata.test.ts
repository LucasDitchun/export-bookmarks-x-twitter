import { describe, expect, it, vi } from "vitest";

import type { BookmarkMetadataReadModel } from "../domain/types";
import type { RuntimeResponse, UiRequest } from "../shared/protocol";
import { loadBookmarkMetadataDraft, saveBookmarkMetadata } from "./bookmark-metadata";

const bookmark: BookmarkMetadataReadModel = {
  id: "123",
  note: "Old note",
  folderId: "folder-old",
  tagIds: ["tag-keep", "tag-remove"],
};

describe("saveBookmarkMetadata", () => {
  it("round-trips delimiter characters through structured tag and folder tokens", async () => {
    const requests: UiRequest[] = [];
    const send = vi.fn(
      async (request: UiRequest): Promise<RuntimeResponse<unknown>> => {
        requests.push(request);
        return { ok: true, data: { bookmark } };
      },
    );

    await saveBookmarkMetadata({
      bookmark,
      values: {
        description: "<b>Keep as plain text</b>",
        tags: [
          { id: "tag-ai", name: "AI, ML" },
          { id: null, name: "New, exact" },
        ],
        folder: { id: null, path: ["R&D/Video"] },
      },
      send,
    });

    expect(requests).toEqual([
      {
        type: "SAVE_BOOKMARK_METADATA",
        payload: {
          id: "123",
          note: "<b>Keep as plain text</b>",
          tags: [
            { id: "tag-ai", name: "AI, ML" },
            { id: null, name: "New, exact" },
          ],
          folder: { id: null, path: ["R&D/Video"] },
        },
      },
    ]);
  });

  it("sends each modal save as one independent replacement", async () => {
    const original = { ...bookmark, tagIds: [] as string[] };
    const requests: UiRequest[] = [];
    const send = vi.fn(
      async (request: UiRequest): Promise<RuntimeResponse<unknown>> => {
        requests.push(request);
        return { ok: true, data: { bookmark: original } };
      },
    );

    await saveBookmarkMetadata({
      bookmark: original,
      values: {
        description: "",
        tags: [{ id: null, name: "Research" }],
        folder: null,
      },
      send,
    });
    await saveBookmarkMetadata({
      bookmark: original,
      values: { description: "", tags: [], folder: null },
      send,
    });

    expect(requests).toEqual([
      {
        type: "SAVE_BOOKMARK_METADATA",
        payload: {
          id: "123",
          note: "",
          tags: [{ id: null, name: "Research" }],
          folder: null,
        },
      },
      {
        type: "SAVE_BOOKMARK_METADATA",
        payload: { id: "123", note: "", tags: [], folder: null },
      },
    ]);
  });

  it("sends note-only organization intent without materializing hidden links", async () => {
    const send = vi.fn(async (): Promise<RuntimeResponse<unknown>> => ({
      ok: true,
      data: { bookmark },
    }));

    await saveBookmarkMetadata({
      bookmark,
      values: {
        description: "Only the note changed",
        tags: [],
        folder: null,
        organizationChanges: { tags: false, folder: false },
      },
      send,
    });

    expect(send).toHaveBeenCalledWith({
      type: "SAVE_BOOKMARK_METADATA",
      payload: {
        id: "123",
        note: "Only the note changed",
        tags: [],
        folder: null,
        organizationChanges: { tags: false, folder: false },
      },
    });
  });

  it("rejects invalid modal values before sending any partial update", async () => {
    const send = vi.fn(async (): Promise<RuntimeResponse<unknown>> => ({
      ok: true,
      data: null,
    }));
    await expect(
      saveBookmarkMetadata({
        bookmark,
        values: {
          description: "x".repeat(20_001),
          tags: [{ id: null, name: "valid" }],
          folder: { id: null, path: ["Research"] },
        },
        send,
      }),
    ).rejects.toThrow("20,000");
    expect(send).not.toHaveBeenCalled();
  });

  it("loads existing metadata as ID-backed tokens without serializing delimiters", async () => {
    const send = vi.fn(async (request: UiRequest): Promise<RuntimeResponse<unknown>> =>
      request.type === "LIST_TAGS"
        ? {
            ok: true,
            data: {
              tags: [{ id: "tag-ai", name: "AI, ML", normalizedName: "ai, ml" }],
            },
          }
        : {
            ok: true,
            data: {
              folders: [{ id: "folder-video", name: "R&D/Video", parentId: null }],
            },
          },
    );

    await expect(
      loadBookmarkMetadataDraft({
        bookmark: {
          ...bookmark,
          tagIds: ["tag-ai"],
          folderId: "folder-video",
        },
        send,
      }),
    ).resolves.toEqual({
      values: {
        description: "Old note",
        tags: [{ id: "tag-ai", name: "AI, ML" }],
        folder: { id: "folder-video", path: ["R&D/Video"] },
      },
      choices: {
        tags: [{ id: "tag-ai", name: "AI, ML" }],
        folders: [{ id: "folder-video", path: ["R&D/Video"] }],
      },
    });
  });
});
