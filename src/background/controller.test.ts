import { describe, expect, it, vi } from "vitest";

import type { ArchiveStats, BookmarkSnapshot, ScrapeRun } from "../domain/types";
import {
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  type SettingsPatch,
} from "../settings/settings-repository";
import { BackupSettingsWriteError } from "../storage/backup-repository";
import { BackgroundController, isBookmarksUrl } from "./controller";

const EXTENSION_ID = "bookmark-x-extension";
const POPUP_SENDER = { id: EXTENSION_ID };
const CONTENT_SENDER = {
  id: EXTENSION_ID,
  tab: { id: 7, url: "https://x.com/i/bookmarks" },
};

const stats: ArchiveStats = {
  total: 2,
  current: 1,
  archived: 1,
  lastSuccessfulSyncAt: "2026-07-29T12:00:00.000Z",
};

const bookmark: BookmarkSnapshot = {
  id: "123",
  text: "Captured from the page",
  url: "https://x.com/person/status/123",
  author: { id: "person", username: "person", name: "Person" },
  postCreatedAt: "2026-07-29T11:00:00.000Z",
};

function createDependencies(activeUrl = "https://x.com/i/bookmarks") {
  let currentRun: ScrapeRun | null = null;
  let currentSettings = structuredClone(DEFAULT_SETTINGS) as ExtensionSettings;
  return {
    archive: {
      mergeBookmarks: vi.fn(async () => ({ added: 1, updated: 0 })),
      finalizeCapture: vi.fn(async () => undefined),
      getStats: vi.fn(async () => stats),
      getAll: vi.fn(async () => []),
      clear: vi.fn(async () => undefined),
    },
    bookmarks: {
      list: vi.fn(async (): Promise<unknown> => ({ items: [], nextCursor: null })),
      get: vi.fn(async (): Promise<unknown> => null),
      saveNote: vi.fn(async (): Promise<unknown> => null),
    },
    tags: {
      list: vi.fn(async (): Promise<unknown> => []),
      add: vi.fn(async (): Promise<unknown> => null),
      remove: vi.fn(async (): Promise<unknown> => null),
    },
    folders: {
      list: vi.fn(async () => []),
      create: vi.fn(async () => ({
        id: "folder-1",
        name: "Research",
        parentId: null,
      })),
      rename: vi.fn(async () => ({
        id: "folder-1",
        name: "Reading",
        parentId: null,
      })),
      delete: vi.fn(async () => ({
        deletedFolderIds: ["folder-1"],
        uncategorizedBookmarkCount: 1,
      })),
      assignBookmark: vi.fn(async () => ({
        ...bookmark,
        note: "",
        folderId: "folder-1",
      })),
    },
    backup: {
      export: vi.fn(async () => ({
        content: '{"schemaVersion":1}',
        filename: "bookmark-x-backup.json",
      })),
      restore: vi.fn(async (_content: string, mode: "merge" | "replace") => ({
        bookmarks: 2,
        folders: 1,
        tags: 1,
        mode,
        reloadRequired: true as const,
      })),
    },
    state: {
      getScrapeRun: vi.fn(async () => currentRun),
      setScrapeRun: vi.fn(async (run: ScrapeRun) => {
        currentRun = run;
      }),
      clearScrapeRun: vi.fn(async () => {
        currentRun = null;
      }),
    },
    settings: {
      get: vi.fn(async (): Promise<ExtensionSettings> => currentSettings),
      save: vi.fn(async (patch: SettingsPatch): Promise<ExtensionSettings> => {
        currentSettings = {
          ...currentSettings,
          behavior: {
            ...currentSettings.behavior,
            ...patch.behavior,
            metadata: {
              ...currentSettings.behavior.metadata,
              ...patch.behavior?.metadata,
            },
          },
        };
        return currentSettings;
      }),
    },
    browser: {
      getActiveTab: vi.fn(async () => ({ id: 7, url: activeUrl })),
      openBookmarks: vi.fn(async () => undefined),
      sendToTab: vi.fn(async () => ({ accepted: true })),
      configureSurface: vi.fn(async () => undefined),
      openSidePanel: vi.fn(async () => undefined),
    },
    extensionId: EXTENSION_ID,
    now: () => new Date("2026-07-29T13:14:15.123Z"),
    createId: () => "run-1",
  };
}

describe("isBookmarksUrl", () => {
  it("accepts only X bookmark routes", () => {
    expect(isBookmarksUrl("https://x.com/i/bookmarks")).toBe(true);
    expect(isBookmarksUrl("https://www.x.com/i/bookmarks/folder/1")).toBe(true);
    expect(isBookmarksUrl("https://x.com/home")).toBe(false);
    expect(isBookmarksUrl("not a URL")).toBe(false);
  });
});

describe("BackgroundController", () => {
  it("loads and saves settings, then applies the selected action surface", async () => {
    const dependencies = createDependencies();
    const controller = new BackgroundController(dependencies);

    await expect(
      controller.handle({ type: "GET_SETTINGS" }, POPUP_SENDER),
    ).resolves.toMatchObject({
      ok: true,
      data: { settings: { behavior: { surface: "modal" } } },
    });
    await expect(
      controller.handle(
        {
          type: "SAVE_SETTINGS",
          payload: { settings: { behavior: { surface: "sidePanel" } } },
        },
        POPUP_SENDER,
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { settings: { behavior: { surface: "sidePanel" } } },
    });
    expect(dependencies.browser.configureSurface).toHaveBeenCalledWith("sidePanel");
  });

  it("rejects malformed and unknown settings before storage", async () => {
    const dependencies = createDependencies();
    const controller = new BackgroundController(dependencies);

    for (const settings of [
      { behavior: { surface: "drawer" } },
      { behavior: { metadata: { note: "yes" } } },
      { export: { includeStatus: true } },
      { unknown: true },
    ]) {
      await expect(
        controller.handle(
          { type: "SAVE_SETTINGS", payload: { settings } },
          POPUP_SENDER,
        ),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "invalid_request" },
      });
    }
    expect(dependencies.settings.save).not.toHaveBeenCalled();
  });

  it("opens the side panel for a user-initiated X tab request", async () => {
    const dependencies = createDependencies();
    dependencies.settings.get.mockResolvedValueOnce({
      ...(await dependencies.settings.get()),
      behavior: {
        ...(await dependencies.settings.get()).behavior,
        surface: "sidePanel",
      },
    });
    const controller = new BackgroundController(dependencies);

    await expect(
      controller.handle({ type: "OPEN_SELECTED_SURFACE" }, CONTENT_SENDER),
    ).resolves.toEqual({
      ok: true,
      data: { surface: "sidePanel", opened: true },
    });
    expect(dependencies.browser.openSidePanel).toHaveBeenCalledWith(7);
  });

  it("leaves modal opening to the isolated content-script surface", async () => {
    const dependencies = createDependencies();
    const controller = new BackgroundController(dependencies);

    await expect(
      controller.handle({ type: "OPEN_SELECTED_SURFACE" }, CONTENT_SENDER),
    ).resolves.toEqual({
      ok: true,
      data: { surface: "modal", opened: false },
    });
    expect(dependencies.browser.openSidePanel).not.toHaveBeenCalled();
  });

  it("exports a local JSON backup through the background boundary", async () => {
    const dependencies = createDependencies();
    const controller = new BackgroundController(dependencies);

    await expect(
      controller.handle({ type: "EXPORT_BACKUP" }, POPUP_SENDER),
    ).resolves.toEqual({
      ok: true,
      data: {
        content: '{"schemaVersion":1}',
        filename: "bookmark-x-backup.json",
      },
    });
    expect(dependencies.backup.export).toHaveBeenCalledOnce();
  });

  it("restores merge and explicitly confirmed replace backups", async () => {
    const dependencies = createDependencies();
    const controller = new BackgroundController(dependencies);
    await dependencies.state.setScrapeRun({
      id: "completed-run",
      tabId: 7,
      status: "completed",
      fetched: 2,
      added: 2,
      updated: 0,
      startedAt: "2026-07-29T13:00:00.000Z",
      updatedAt: "2026-07-29T13:01:00.000Z",
      errorCode: null,
    });

    await controller.handle(
      {
        type: "RESTORE_BACKUP",
        payload: { content: '{"schemaVersion":1}', mode: "merge" },
      },
      POPUP_SENDER,
    );
    await controller.handle(
      {
        type: "RESTORE_BACKUP",
        payload: {
          content: '{"schemaVersion":1}',
          mode: "replace",
          confirmed: true,
        },
      },
      POPUP_SENDER,
    );

    expect(dependencies.backup.restore).toHaveBeenNthCalledWith(
      1,
      '{"schemaVersion":1}',
      "merge",
    );
    expect(dependencies.backup.restore).toHaveBeenNthCalledWith(
      2,
      '{"schemaVersion":1}',
      "replace",
    );
    expect(dependencies.state.clearScrapeRun).toHaveBeenCalledTimes(2);
    await expect(
      controller.handle({ type: "GET_STATUS" }, POPUP_SENDER),
    ).resolves.toMatchObject({ ok: true, data: { scrape: null } });
  });

  it("applies the restored action surface after settings commit", async () => {
    const dependencies = createDependencies();
    dependencies.settings.get.mockResolvedValueOnce({
      ...structuredClone(DEFAULT_SETTINGS),
      behavior: {
        ...structuredClone(DEFAULT_SETTINGS.behavior),
        surface: "sidePanel",
      },
    });
    const controller = new BackgroundController(dependencies);

    await controller.handle(
      {
        type: "RESTORE_BACKUP",
        payload: { content: '{"schemaVersion":1}', mode: "merge" },
      },
      POPUP_SENDER,
    );

    expect(dependencies.browser.configureSurface).toHaveBeenCalledWith("sidePanel");
  });

  it("rejects unconfirmed replace and blocks all restores during capture", async () => {
    const dependencies = createDependencies();
    const controller = new BackgroundController(dependencies);

    await expect(
      controller.handle(
        {
          type: "RESTORE_BACKUP",
          payload: { content: "{}", mode: "replace" },
        },
        POPUP_SENDER,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(dependencies.backup.restore).not.toHaveBeenCalled();

    await dependencies.state.setScrapeRun({
      id: "active-run",
      tabId: 7,
      status: "running",
      fetched: 1,
      added: 1,
      updated: 0,
      startedAt: "2026-07-29T13:00:00.000Z",
      updatedAt: "2026-07-29T13:00:00.000Z",
      errorCode: null,
    });
    await expect(
      controller.handle(
        {
          type: "RESTORE_BACKUP",
          payload: { content: "{}", mode: "merge" },
        },
        POPUP_SENDER,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "restore_capture_running" },
    });
    expect(dependencies.backup.restore).not.toHaveBeenCalled();
  });

  it("reports an explicit safe error when only backup settings fail", async () => {
    const dependencies = createDependencies();
    await dependencies.state.setScrapeRun({
      id: "completed-run",
      tabId: 7,
      status: "completed",
      fetched: 2,
      added: 2,
      updated: 0,
      startedAt: "2026-07-29T13:00:00.000Z",
      updatedAt: "2026-07-29T13:01:00.000Z",
      errorCode: null,
    });
    dependencies.backup.restore.mockRejectedValueOnce(new BackupSettingsWriteError());
    const controller = new BackgroundController(dependencies);

    await expect(
      controller.handle(
        {
          type: "RESTORE_BACKUP",
          payload: { content: "{}", mode: "merge" },
        },
        POPUP_SENDER,
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "restore_settings_failed",
        message:
          "The library was restored, but Bookmark X could not apply the backed-up settings.",
        recovery: { dataRestored: true, reloadRequired: true },
      },
    });
    expect(dependencies.state.clearScrapeRun).toHaveBeenCalledOnce();
    await expect(
      controller.handle({ type: "GET_STATUS" }, POPUP_SENDER),
    ).resolves.toMatchObject({ ok: true, data: { scrape: null } });
  });
  it("lists current bookmarks with a safe default page size", async () => {
    const dependencies = createDependencies();
    const controller = new BackgroundController(dependencies);

    await expect(
      controller.handle(
        { type: "LIST_BOOKMARKS", payload: { view: "current" } },
        POPUP_SENDER,
      ),
    ).resolves.toEqual({
      ok: true,
      data: { items: [], nextCursor: null },
    });
    expect(dependencies.bookmarks.list).toHaveBeenCalledWith({
      view: "current",
      limit: 50,
    });
  });

  it("forwards opaque cursors and caps requested bookmark pages at 100", async () => {
    const dependencies = createDependencies();
    const controller = new BackgroundController(dependencies);

    await controller.handle(
      {
        type: "LIST_BOOKMARKS",
        payload: { view: "archived", cursor: "opaque:cursor", limit: 999 },
      },
      POPUP_SENDER,
    );

    expect(dependencies.bookmarks.list).toHaveBeenCalledWith({
      view: "archived",
      cursor: "opaque:cursor",
      limit: 100,
    });
  });

  it("gets one bookmark by its validated X status ID", async () => {
    const dependencies = createDependencies();
    const storedBookmark = { ...bookmark, note: "Remember this" };
    dependencies.bookmarks.get.mockResolvedValueOnce(storedBookmark);
    const controller = new BackgroundController(dependencies);

    await expect(
      controller.handle({ type: "GET_BOOKMARK", payload: { id: "123" } }, POPUP_SENDER),
    ).resolves.toEqual({
      ok: true,
      data: { bookmark: storedBookmark },
    });
    expect(dependencies.bookmarks.get).toHaveBeenCalledWith("123");
  });

  it("saves a plain-text bookmark note and returns the updated bookmark", async () => {
    const dependencies = createDependencies();
    const storedBookmark = { ...bookmark, note: "<b>Keep as text</b>" };
    dependencies.bookmarks.saveNote.mockResolvedValueOnce(storedBookmark);
    const controller = new BackgroundController(dependencies);

    await expect(
      controller.handle(
        {
          type: "SAVE_BOOKMARK_NOTE",
          payload: { id: "123", note: "<b>Keep as text</b>" },
        },
        POPUP_SENDER,
      ),
    ).resolves.toEqual({
      ok: true,
      data: { bookmark: storedBookmark },
    });
    expect(dependencies.bookmarks.saveNote).toHaveBeenCalledWith(
      "123",
      "<b>Keep as text</b>",
    );
  });

  it("lists, assigns, and removes validated bookmark tags", async () => {
    const dependencies = createDependencies();
    const tag = {
      id: "tag-research",
      name: "Research",
      normalizedName: "research",
    };
    const taggedBookmark = { ...bookmark, note: "", tagIds: [tag.id] };
    dependencies.tags.list.mockResolvedValueOnce([tag]);
    dependencies.tags.add.mockResolvedValueOnce({ bookmark: taggedBookmark, tag });
    dependencies.tags.remove.mockResolvedValueOnce({ ...taggedBookmark, tagIds: [] });
    const controller = new BackgroundController(dependencies);

    await expect(
      controller.handle({ type: "LIST_TAGS" }, POPUP_SENDER),
    ).resolves.toEqual({ ok: true, data: { tags: [tag] } });
    await expect(
      controller.handle(
        {
          type: "ADD_BOOKMARK_TAG",
          payload: { id: "123", name: " Research " },
        },
        POPUP_SENDER,
      ),
    ).resolves.toEqual({
      ok: true,
      data: { bookmark: taggedBookmark, tag },
    });
    await expect(
      controller.handle(
        {
          type: "REMOVE_BOOKMARK_TAG",
          payload: { id: "123", tagId: "tag-research" },
        },
        POPUP_SENDER,
      ),
    ).resolves.toEqual({
      ok: true,
      data: { bookmark: { ...taggedBookmark, tagIds: [] } },
    });
    expect(dependencies.tags.add).toHaveBeenCalledWith("123", " Research ");
    expect(dependencies.tags.remove).toHaveBeenCalledWith("123", "tag-research");
  });

  it("rejects invalid tag requests at the extension boundary", async () => {
    const dependencies = createDependencies();
    const controller = new BackgroundController(dependencies);

    for (const request of [
      { type: "ADD_BOOKMARK_TAG", payload: { id: "123", name: "   " } },
      {
        type: "ADD_BOOKMARK_TAG",
        payload: { id: "123", name: "x".repeat(51) },
      },
      {
        type: "ADD_BOOKMARK_TAG",
        payload: { id: "123", name: `${" ".repeat(200)}x` },
      },
      {
        type: "REMOVE_BOOKMARK_TAG",
        payload: { id: "123", tagId: "<script>" },
      },
    ]) {
      await expect(controller.handle(request, POPUP_SENDER)).resolves.toMatchObject({
        ok: false,
        error: { code: "invalid_request" },
      });
    }
    expect(dependencies.tags.add).not.toHaveBeenCalled();
    expect(dependencies.tags.remove).not.toHaveBeenCalled();
  });

  it("routes validated hierarchical folder operations", async () => {
    const dependencies = createDependencies();
    const controller = new BackgroundController(dependencies);

    await expect(
      controller.handle({ type: "LIST_FOLDERS" }, POPUP_SENDER),
    ).resolves.toEqual({ ok: true, data: { folders: [] } });
    await controller.handle(
      {
        type: "CREATE_FOLDER",
        payload: { name: "Research", parentId: null },
      },
      POPUP_SENDER,
    );
    await controller.handle(
      {
        type: "CREATE_FOLDER",
        payload: { name: "AI", parentId: "folder-1" },
      },
      POPUP_SENDER,
    );
    await controller.handle(
      {
        type: "RENAME_FOLDER",
        payload: { id: "folder-1", name: "Reading" },
      },
      POPUP_SENDER,
    );
    await controller.handle(
      { type: "DELETE_FOLDER", payload: { id: "folder-1" } },
      POPUP_SENDER,
    );
    await controller.handle(
      {
        type: "ASSIGN_BOOKMARK_FOLDER",
        payload: { bookmarkId: "123", folderId: "folder-1" },
      },
      POPUP_SENDER,
    );
    await controller.handle(
      {
        type: "ASSIGN_BOOKMARK_FOLDER",
        payload: { bookmarkId: "123", folderId: null },
      },
      POPUP_SENDER,
    );

    expect(dependencies.folders.create).toHaveBeenNthCalledWith(1, {
      name: "Research",
      parentId: null,
    });
    expect(dependencies.folders.create).toHaveBeenNthCalledWith(2, {
      name: "AI",
      parentId: "folder-1",
    });
    expect(dependencies.folders.rename).toHaveBeenCalledWith("folder-1", "Reading");
    expect(dependencies.folders.delete).toHaveBeenCalledWith("folder-1");
    expect(dependencies.folders.assignBookmark).toHaveBeenNthCalledWith(
      1,
      "123",
      "folder-1",
    );
    expect(dependencies.folders.assignBookmark).toHaveBeenNthCalledWith(2, "123", null);
  });

  it("rejects malformed folder operations before storage", async () => {
    const dependencies = createDependencies();
    const controller = new BackgroundController(dependencies);
    const requests = [
      { type: "CREATE_FOLDER", payload: { name: " ", parentId: null } },
      {
        type: "CREATE_FOLDER",
        payload: { name: "Valid", parentId: "../../folder" },
      },
      { type: "RENAME_FOLDER", payload: { id: "folder-1", name: "x".repeat(101) } },
      { type: "DELETE_FOLDER", payload: { id: "<script>" } },
      {
        type: "ASSIGN_BOOKMARK_FOLDER",
        payload: { bookmarkId: "123", folderId: "<script>" },
      },
    ];

    for (const request of requests) {
      await expect(controller.handle(request, POPUP_SENDER)).resolves.toMatchObject({
        ok: false,
        error: { code: "invalid_request" },
      });
    }
    expect(dependencies.folders.create).not.toHaveBeenCalled();
    expect(dependencies.folders.rename).not.toHaveBeenCalled();
    expect(dependencies.folders.delete).not.toHaveBeenCalled();
    expect(dependencies.folders.assignBookmark).not.toHaveBeenCalled();
  });

  it("rejects invalid bookmark IDs and notes over 20,000 characters", async () => {
    const dependencies = createDependencies();
    const controller = new BackgroundController(dependencies);

    await expect(
      controller.handle(
        { type: "GET_BOOKMARK", payload: { id: "../../123" } },
        POPUP_SENDER,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_request" } });
    await expect(
      controller.handle(
        {
          type: "SAVE_BOOKMARK_NOTE",
          payload: { id: "123", note: "x".repeat(20_001) },
        },
        POPUP_SENDER,
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(dependencies.bookmarks.get).not.toHaveBeenCalled();
    expect(dependencies.bookmarks.saveNote).not.toHaveBeenCalled();
  });

  it("reports whether the active page is ready for capture", async () => {
    const controller = new BackgroundController(createDependencies());

    await expect(
      controller.handle({ type: "GET_STATUS" }, POPUP_SENDER),
    ).resolves.toEqual({
      ok: true,
      data: { pageReady: true, stats, scrape: null },
    });
  });

  it("starts capture only on the X bookmarks page", async () => {
    const dependencies = createDependencies();
    const controller = new BackgroundController(dependencies);

    await expect(
      controller.handle({ type: "START_SCRAPE" }, POPUP_SENDER),
    ).resolves.toMatchObject({
      ok: true,
      data: { id: "run-1", tabId: 7, status: "running" },
    });
    expect(dependencies.browser.sendToTab).toHaveBeenCalledWith(7, {
      type: "START_SCRAPE",
      runId: "run-1",
    });

    const wrongPage = new BackgroundController(
      createDependencies("https://x.com/home"),
    );
    await expect(
      wrongPage.handle({ type: "START_SCRAPE" }, POPUP_SENDER),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "bookmarks_page_required" },
    });
  });

  it("archives validated content-script batches and finalizes complete captures", async () => {
    const dependencies = createDependencies();
    const controller = new BackgroundController(dependencies);
    await controller.handle({ type: "START_SCRAPE" }, POPUP_SENDER);

    await expect(
      controller.handle(
        { type: "SCRAPE_BATCH", runId: "run-1", bookmarks: [bookmark] },
        CONTENT_SENDER,
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { fetched: 1, added: 1, updated: 0 },
    });
    await expect(
      controller.handle(
        {
          type: "SCRAPE_COMPLETE",
          runId: "run-1",
          status: "completed",
          fetched: 1,
        },
        CONTENT_SENDER,
      ),
    ).resolves.toMatchObject({
      ok: true,
      data: { status: "completed", fetched: 1 },
    });

    expect(dependencies.archive.mergeBookmarks).toHaveBeenCalledWith(
      [bookmark],
      "run-1",
      "2026-07-29T13:14:15.123Z",
    );
    expect(dependencies.archive.finalizeCapture).toHaveBeenCalledWith(
      "run-1",
      "2026-07-29T13:14:15.123Z",
    );
  });

  it("rejects malformed or untrusted capture messages", async () => {
    const dependencies = createDependencies();
    const controller = new BackgroundController(dependencies);
    await controller.handle({ type: "START_SCRAPE" }, POPUP_SENDER);

    await expect(
      controller.handle(
        {
          type: "SCRAPE_BATCH",
          runId: "run-1",
          bookmarks: [{ ...bookmark, url: "javascript:alert(1)" }],
        },
        CONTENT_SENDER,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    await expect(
      controller.handle(
        { type: "SCRAPE_PROGRESS", runId: "run-1", fetched: 10 },
        { ...CONTENT_SENDER, id: "another-extension" },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_sender" },
    });
  });

  it("cancels the active page capture without finalizing missing bookmarks", async () => {
    const dependencies = createDependencies();
    const controller = new BackgroundController(dependencies);
    await controller.handle({ type: "START_SCRAPE" }, POPUP_SENDER);

    await expect(
      controller.handle({ type: "CANCEL_SCRAPE" }, POPUP_SENDER),
    ).resolves.toMatchObject({
      ok: true,
      data: { status: "cancelled" },
    });
    expect(dependencies.browser.sendToTab).toHaveBeenLastCalledWith(7, {
      type: "CANCEL_SCRAPE",
      runId: "run-1",
    });
    expect(dependencies.archive.finalizeCapture).not.toHaveBeenCalled();
  });

  it("routes open, export, and clear actions", async () => {
    const dependencies = createDependencies();
    const controller = new BackgroundController(dependencies);

    await controller.handle({ type: "OPEN_BOOKMARKS" }, POPUP_SENDER);
    await expect(
      controller.handle(
        {
          type: "EXPORT_BOOKMARKS",
          payload: { format: "urls", locale: "ja" },
        },
        POPUP_SENDER,
      ),
    ).resolves.toEqual({
      ok: true,
      data: {
        content: "\uFEFF",
        filename: "bookmark-x-2026-07-29T13-14-15Z-urls.txt",
      },
    });
    await controller.handle({ type: "CLEAR_ARCHIVE" }, POPUP_SENDER);

    expect(dependencies.browser.openBookmarks).toHaveBeenCalledOnce();
    expect(dependencies.archive.clear).toHaveBeenCalledOnce();
    expect(dependencies.state.clearScrapeRun).toHaveBeenCalledOnce();
  });

  it("requires extension-owned popup messages and handles unavailable content scripts", async () => {
    const dependencies = createDependencies();
    dependencies.browser.sendToTab.mockRejectedValueOnce(new Error("no receiver"));
    const controller = new BackgroundController(dependencies);

    await expect(controller.handle({ type: "GET_STATUS" })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    await expect(
      controller.handle({ type: "START_SCRAPE" }, POPUP_SENDER),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "content_script_unavailable" },
    });
    expect(dependencies.state.setScrapeRun).toHaveBeenCalledTimes(2);
  });
});
