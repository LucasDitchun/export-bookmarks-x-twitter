import { describe, expect, it, vi } from "vitest";

import type { BookmarkRecord } from "../domain/types";
import type { RuntimeResponse, UiRequest } from "../shared/protocol";
import { loadBookmarkMetadataDraft, saveBookmarkMetadata } from "./bookmark-metadata";

const bookmark: BookmarkRecord = {
  id: "123",
  text: "Post",
  url: "https://x.com/alice/status/123",
  author: { id: "alice", username: "alice", name: "Alice" },
  postCreatedAt: "2026-08-09T09:00:00.000Z",
  media: { images: [], videos: [] },
  note: "Old note",
  folderId: "folder-old",
  tagIds: ["tag-keep", "tag-remove"],
  firstSavedAt: "2026-08-09T09:01:00.000Z",
  lastSeenAt: "2026-08-09T09:01:00.000Z",
  archivedAt: null,
  metadataUpdatedAt: "2026-08-09T09:01:00.000Z",
  status: "current",
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
          tags: ["AI, ML", "New, exact"],
          folderPath: ["R&D/Video"],
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
        payload: { id: "123", note: "", tags: ["Research"], folderPath: [] },
      },
      {
        type: "SAVE_BOOKMARK_METADATA",
        payload: { id: "123", note: "", tags: [], folderPath: [] },
      },
    ]);
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
    const send = vi.fn(
      async (request: UiRequest): Promise<RuntimeResponse<unknown>> =>
        request.type === "LIST_TAGS"
          ? {
              ok: true,
              data: {
                tags: [
                  { id: "tag-ai", name: "AI, ML", normalizedName: "ai, ml" },
                ],
              },
            }
          : {
              ok: true,
              data: {
                folders: [
                  { id: "folder-video", name: "R&D/Video", parentId: null },
                ],
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
