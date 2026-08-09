import { describe, expect, it, vi } from "vitest";

import type { BookmarkRecord, FolderRecord } from "../domain/types";
import type { RuntimeResponse, UiRequest } from "../shared/protocol";
import { saveBookmarkMetadata } from "./bookmark-metadata";

const bookmark: BookmarkRecord = {
  id: "123",
  text: "Post",
  url: "https://x.com/alice/status/123",
  author: { id: "alice", username: "alice", name: "Alice" },
  postCreatedAt: "2026-08-09T09:00:00.000Z",
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
    const folders: FolderRecord[] = [
      { id: "folder-research", name: "Research", parentId: null },
    ];
    const requests: UiRequest[] = [];
    const send = vi.fn(
      async (request: UiRequest): Promise<RuntimeResponse<unknown>> => {
        requests.push(request);
        if (request.type === "LIST_TAGS") {
          return {
            ok: true,
            data: {
              tags: [
                { id: "tag-keep", name: "Keep", normalizedName: "keep" },
                { id: "tag-remove", name: "Remove", normalizedName: "remove" },
              ],
            },
          };
        }
        if (request.type === "LIST_FOLDERS") {
          return { ok: true, data: { folders } };
        }
        if (request.type === "CREATE_FOLDER") {
          const folder = {
            id: "folder-ai",
            name: request.payload.name,
            parentId: request.payload.parentId,
          };
          folders.push(folder);
          return { ok: true, data: { folder } };
        }
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

    expect(requests).toContainEqual({
      type: "SAVE_BOOKMARK_NOTE",
      payload: { id: "123", note: "<b>Keep as plain text</b>" },
    });
    expect(requests).toContainEqual({
      type: "REMOVE_BOOKMARK_TAG",
      payload: { id: "123", tagId: "tag-remove" },
    });
    expect(requests).toContainEqual({
      type: "ADD_BOOKMARK_TAG",
      payload: { id: "123", name: "New" },
    });
    expect(requests).toContainEqual({
      type: "CREATE_FOLDER",
      payload: { name: "AI", parentId: "folder-research" },
    });
    expect(requests.at(-1)).toEqual({
      type: "ASSIGN_BOOKMARK_FOLDER",
      payload: { bookmarkId: "123", folderId: "folder-ai" },
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
          tags: "valid",
          folder: "Research",
        },
        send,
      }),
    ).rejects.toThrow("20,000");
    expect(send).not.toHaveBeenCalled();
  });
});
