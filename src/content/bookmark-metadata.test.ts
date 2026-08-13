import { describe, expect, it, vi } from "vitest";

import type { BookmarkRecord } from "../domain/types";
import type { RuntimeResponse, UiRequest } from "../shared/protocol";
import { saveBookmarkMetadata } from "./bookmark-metadata";

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
  it("reconciles a plain note, tags, and hierarchical folder from the modal", async () => {
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
        tags: " Keep, New ",
        folder: "Research / AI",
      },
      send,
    });

    expect(requests).toEqual([
      {
        type: "SAVE_BOOKMARK_METADATA",
        payload: {
          id: "123",
          note: "<b>Keep as plain text</b>",
          tags: ["Keep", "New"],
          folderPath: ["Research", "AI"],
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
      values: { description: "", tags: "Research", folder: "" },
      send,
    });
    await saveBookmarkMetadata({
      bookmark: original,
      values: { description: "", tags: "", folder: "" },
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
          tags: "valid",
          folder: "Research",
        },
        send,
      }),
    ).rejects.toThrow("20,000");
    expect(send).not.toHaveBeenCalled();
  });
});
