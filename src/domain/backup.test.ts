import { describe, expect, it } from "vitest";

import {
  BACKUP_SCHEMA_VERSION,
  BackupValidationError,
  parseBackup,
  serializeBackup,
  type BookmarkXBackup,
} from "./backup";
import {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
} from "../settings/settings-repository";

const backup: BookmarkXBackup = {
  schemaVersion: BACKUP_SCHEMA_VERSION,
  exportedAt: "2026-08-09T08:00:00.000Z",
  data: {
    bookmarks: [
      {
        id: "123",
        text: "Plain <script>text</script>",
        url: "https://x.com/person/status/123",
        author: { id: "456", username: "person", name: "Person" },
        postCreatedAt: "2026-07-01T10:00:00.000Z",
        media: {
          images: ["https://pbs.twimg.com/media/abc?format=jpg&name=large"],
          videos: [
            {
              thumbnailUrl:
                "https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/thumb.jpg",
              postUrl: "https://x.com/person/status/123",
            },
          ],
        },
        note: "Why this matters",
        folderId: "folder-ai",
        tagIds: ["tag-research"],
        firstSavedAt: "2026-07-02T10:00:00.000Z",
        lastSeenAt: "2026-07-03T10:00:00.000Z",
        archivedAt: null,
        metadataUpdatedAt: "2026-07-04T10:00:00.000Z",
        status: "current",
      },
    ],
    folders: [
      { id: "folder-root", name: "Reading", parentId: null },
      { id: "folder-ai", name: "AI", parentId: "folder-root" },
    ],
    tags: [
      {
        id: "tag-research",
        name: "Research",
        normalizedName: "research",
      },
    ],
    archive: { lastSuccessfulSyncAt: "2026-07-03T10:05:00.000Z" },
    settings: {
      uiLocale: "en",
      extension: {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        settings: {
          ...structuredClone(DEFAULT_SETTINGS),
          behavior: {
            ...structuredClone(DEFAULT_SETTINGS.behavior),
            surface: "sidePanel",
            metadata: {
              ...structuredClone(DEFAULT_SETTINGS.behavior.metadata),
              note: false,
            },
          },
          export: {
            ...structuredClone(DEFAULT_SETTINGS.export),
            includeVideos: false,
          },
        },
      },
    },
  },
};

function changed(mutator: (draft: BookmarkXBackup) => void): string {
  const draft = structuredClone(backup);
  mutator(draft);
  return JSON.stringify(draft);
}

describe("backup schema", () => {
  it("round-trips a complete, explicitly versioned backup", () => {
    const content = serializeBackup(backup);

    expect(parseBackup(content)).toEqual(backup);
    expect(content).toContain('"schemaVersion": 2');
    expect(content).not.toContain("scrapeRun");
    expect(content).not.toContain("bookmarkFolders");
  });

  it("migrates schema version 1 backups by adding empty media", () => {
    const legacy = structuredClone(backup) as unknown as {
      schemaVersion: number;
      data: { bookmarks: Array<Record<string, unknown>> };
    };
    legacy.schemaVersion = 1;
    delete legacy.data.bookmarks[0]?.media;

    const restored = parseBackup(JSON.stringify(legacy));

    expect(restored.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(restored.data.bookmarks[0]?.media).toEqual({ images: [], videos: [] });
  });

  it("preserves the established missing post-date sentinel for media cards", () => {
    const draft = structuredClone(backup);
    draft.data.bookmarks[0]!.postCreatedAt = "";

    expect(parseBackup(JSON.stringify(draft)).data.bookmarks[0]?.postCreatedAt).toBe(
      "",
    );
  });

  it.each([
    [
      "unsupported schema",
      (draft: BookmarkXBackup) => Object.assign(draft, { schemaVersion: 99 }),
    ],
    [
      "unknown top-level key",
      (draft: BookmarkXBackup) =>
        Object.assign(draft, { __proto__: "unsafe", extra: true }),
    ],
    [
      "non-digit bookmark id",
      (draft: BookmarkXBackup) => void (draft.data.bookmarks[0]!.id = "post-1"),
    ],
    [
      "mismatched status URL",
      (draft: BookmarkXBackup) =>
        void (draft.data.bookmarks[0]!.url = "https://x.com/person/status/999"),
    ],
    [
      "invalid date",
      (draft: BookmarkXBackup) => void (draft.data.bookmarks[0]!.lastSeenAt = "today"),
    ],
    [
      "impossible timestamp order",
      (draft: BookmarkXBackup) =>
        void (draft.data.bookmarks[0]!.lastSeenAt = "2026-07-01T00:00:00.000Z"),
    ],
    [
      "current bookmark archived date",
      (draft: BookmarkXBackup) =>
        void (draft.data.bookmarks[0]!.archivedAt = "2026-07-05T10:00:00.000Z"),
    ],
    [
      "duplicate bookmark id",
      (draft: BookmarkXBackup) =>
        void draft.data.bookmarks.push(structuredClone(draft.data.bookmarks[0]!)),
    ],
    [
      "missing folder reference",
      (draft: BookmarkXBackup) => void (draft.data.bookmarks[0]!.folderId = "missing"),
    ],
    [
      "missing tag reference",
      (draft: BookmarkXBackup) => void (draft.data.bookmarks[0]!.tagIds = ["missing"]),
    ],
    [
      "duplicate tag assignment",
      (draft: BookmarkXBackup) =>
        void (draft.data.bookmarks[0]!.tagIds = ["tag-research", "tag-research"]),
    ],
    [
      "folder cycle",
      (draft: BookmarkXBackup) => void (draft.data.folders[0]!.parentId = "folder-ai"),
    ],
    [
      "duplicate sibling folder",
      (draft: BookmarkXBackup) =>
        void draft.data.folders.push({
          id: "folder-other",
          name: "ai",
          parentId: "folder-root",
        }),
    ],
    [
      "duplicate normalized tag",
      (draft: BookmarkXBackup) =>
        void draft.data.tags.push({
          id: "tag-other",
          name: "ＲＥＳＥＡＲＣＨ",
          normalizedName: "research",
        }),
    ],
    [
      "incorrect normalized tag",
      (draft: BookmarkXBackup) =>
        void (draft.data.tags[0]!.normalizedName = "Research"),
    ],
    [
      "temporary image URL",
      (draft: BookmarkXBackup) =>
        void (draft.data.bookmarks[0]!.media.images = ["blob:https://x.com/temporary"]),
    ],
    [
      "direct video URL as thumbnail",
      (draft: BookmarkXBackup) =>
        void (draft.data.bookmarks[0]!.media.videos[0]!.thumbnailUrl =
          "https://video.twimg.com/ext_tw_video/123/file.mp4"),
    ],
    [
      "mismatched video post URL",
      (draft: BookmarkXBackup) =>
        void (draft.data.bookmarks[0]!.media.videos[0]!.postUrl =
          "https://x.com/person/status/999"),
    ],
    [
      "duplicate image URL",
      (draft: BookmarkXBackup) =>
        void draft.data.bookmarks[0]!.media.images.push(
          draft.data.bookmarks[0]!.media.images[0]!,
        ),
    ],
    [
      "unknown extension setting",
      (draft: BookmarkXBackup) =>
        Object.assign(draft.data.settings.extension.settings, { unknown: true }),
    ],
    [
      "unknown nested extension setting",
      (draft: BookmarkXBackup) =>
        Object.assign(draft.data.settings.extension.settings.behavior.metadata, {
          unknown: true,
        }),
    ],
    [
      "invalid settings envelope version",
      (draft: BookmarkXBackup) =>
        Object.assign(draft.data.settings.extension, { schemaVersion: 99 }),
    ],
    [
      "invalid complete setting type",
      (draft: BookmarkXBackup) =>
        Object.assign(draft.data.settings.extension.settings.export, {
          includeVideos: "yes",
        }),
    ],
  ])("rejects %s before storage", (_label, mutate) => {
    expect(() => parseBackup(changed(mutate))).toThrow(BackupValidationError);
  });

  it("rejects oversized JSON before parsing", () => {
    expect(() => parseBackup(" ".repeat(50 * 1024 * 1024 + 1))).toThrow(/too large/i);
  });

  it("returns safe validation errors without echoing imported content", () => {
    const privateMarker = "private-note-that-must-not-leak";
    try {
      parseBackup(`{"${privateMarker}":`);
    } catch (error) {
      expect(error).toBeInstanceOf(BackupValidationError);
      expect((error as Error).message).not.toContain(privateMarker);
    }
  });
});
