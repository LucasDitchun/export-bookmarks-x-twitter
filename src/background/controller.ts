import { exportBookmarks } from "../domain/export-bookmarks";
import { BackupValidationError } from "../domain/backup";
import { MAX_SEARCH_QUERY_LENGTH } from "../domain/search-bookmarks";
import {
  isSupportedLocale,
  type BookmarkTag,
  type BookmarkRecord,
  type BookmarkSnapshot,
  type FolderRecord,
  type ScrapeRun,
  type SupportedLocale,
} from "../domain/types";
import { folderBreadcrumb } from "../domain/folder-tree";
import { isBookmarkMedia } from "../domain/bookmark-media";
import type {
  ContentControlRequest,
  ContentEvent,
  ExportResult,
  PopupStatus,
  RuntimeResponse,
  UiRequest,
  BookmarkView,
  LiveBookmarkContext,
  LiveBookmarkEvent,
} from "../shared/protocol";
import { BookmarkXError } from "../shared/errors";
import {
  isSettingsPatch,
  type ExtensionSettings,
  type LibrarySurface,
  type SettingsPatch,
} from "../settings/settings-repository";
import type { ArchiveRepository } from "../storage/archive-repository";
import type { ExtensionStateRepository } from "../storage/extension-state";
import {
  BackupSettingsWriteError,
  type BackupRepository,
} from "../storage/backup-repository";

interface ActiveTab {
  id: number;
  url?: string | undefined;
}

interface BrowserBridge {
  getActiveTab(): Promise<ActiveTab | null>;
  openBookmarks(): Promise<void>;
  sendToTab(tabId: number, request: ContentControlRequest): Promise<unknown>;
  configureSurface(surface: LibrarySurface): Promise<void>;
  openSidePanel(tabId: number): Promise<void>;
}

interface MessageSender {
  id?: string | undefined;
  url?: string | undefined;
  tab?: { id?: number | undefined; url?: string | undefined } | undefined;
}

interface BackgroundDependencies {
  archive: Pick<
    ArchiveRepository,
    | "mergeBookmarks"
    | "finalizeCapture"
    | "discardCapture"
    | "applyLiveBookmark"
    | "getAll"
    | "getStats"
    | "clear"
  >;
  state: Pick<
    ExtensionStateRepository,
    "getScrapeRun" | "setScrapeRun" | "clearScrapeRun"
  >;
  bookmarks: {
    list(options: {
      view: BookmarkView;
      cursor?: string;
      limit: number;
    }): Promise<unknown>;
    get(id: string): Promise<unknown>;
    getMany(ids: string[]): Promise<BookmarkRecord[]>;
    saveNote(id: string, note: string): Promise<unknown>;
  };
  search: {
    search(options: {
      query: string;
      view: BookmarkView;
      cursor?: string;
      limit: number;
    }): Promise<unknown>;
    listDocuments(): Promise<unknown>;
    invalidate(): void;
  };
  tags: {
    list(): Promise<unknown>;
    add(bookmarkId: string, name: string): Promise<unknown>;
    remove(bookmarkId: string, tagId: string): Promise<unknown>;
  };
  folders: {
    list(): Promise<unknown>;
    create(input: { name: string; parentId: string | null }): Promise<unknown>;
    rename(id: string, name: string): Promise<unknown>;
    delete(id: string): Promise<unknown>;
    assignBookmark(bookmarkId: string, folderId: string | null): Promise<unknown>;
  };
  settings: {
    get(): Promise<ExtensionSettings>;
    save(patch: SettingsPatch): Promise<ExtensionSettings>;
  };
  locale: {
    get(): Promise<{
      locale: SupportedLocale;
      messages: Record<string, string>;
    }>;
  };
  backup: Pick<BackupRepository, "export" | "restore">;
  liveState: {
    get(tabId: number, intentId: string): Promise<LiveBookmarkContext | null>;
    set(tabId: number, context: LiveBookmarkContext): Promise<void>;
  };
  browser: BrowserBridge;
  extensionId: string;
  now?: () => Date;
  createId?: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBookmarkId(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

function isLocalEntityId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function isFolderName(value: unknown): value is string {
  const hasControlCharacters =
    typeof value === "string" &&
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    });
  return (
    typeof value === "string" &&
    value.trim().length >= 1 &&
    value.trim().length <= 100 &&
    !hasControlCharacters
  );
}

export function isBookmarksUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      (url.hostname === "x.com" || url.hostname === "www.x.com") &&
      (url.pathname === "/i/bookmarks" || url.pathname.startsWith("/i/bookmarks/"))
    );
  } catch {
    return false;
  }
}

export function isXUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname;
    return hostname === "x.com" || hostname === "www.x.com";
  } catch {
    return false;
  }
}

function isUiRequest(value: unknown): value is UiRequest {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (
    value.type === "GET_STATUS" ||
    value.type === "GET_SETTINGS" ||
    value.type === "GET_SEMANTIC_CORPUS" ||
    value.type === "OPEN_SELECTED_SURFACE" ||
    value.type === "OPEN_BOOKMARKS" ||
    value.type === "START_SCRAPE" ||
    value.type === "CANCEL_SCRAPE" ||
    value.type === "CLEAR_ARCHIVE" ||
    value.type === "EXPORT_BACKUP" ||
    value.type === "LIST_TAGS" ||
    value.type === "LIST_FOLDERS"
  ) {
    return true;
  }
  if (value.type === "SAVE_SETTINGS") {
    return isRecord(value.payload) && isSettingsPatch(value.payload.settings);
  }
  if (value.type === "RESTORE_BACKUP") {
    if (!isRecord(value.payload) || typeof value.payload.content !== "string") {
      return false;
    }
    return (
      (value.payload.mode === "merge" &&
        (value.payload.confirmed === undefined || value.payload.confirmed === false)) ||
      (value.payload.mode === "replace" && value.payload.confirmed === true)
    );
  }
  if (value.type === "LIST_BOOKMARKS") {
    if (value.payload === undefined) return true;
    if (!isRecord(value.payload)) return false;
    const { view, cursor, limit } = value.payload;
    return (
      (view === undefined ||
        view === "current" ||
        view === "inbox" ||
        view === "archived") &&
      (cursor === undefined || typeof cursor === "string") &&
      (limit === undefined ||
        (typeof limit === "number" && Number.isSafeInteger(limit) && limit > 0))
    );
  }
  if (value.type === "SEARCH_BOOKMARKS") {
    if (!isRecord(value.payload)) return false;
    const { query, view, cursor, limit } = value.payload;
    return (
      typeof query === "string" &&
      query.length <= MAX_SEARCH_QUERY_LENGTH &&
      (view === "current" || view === "inbox" || view === "archived") &&
      (cursor === undefined || typeof cursor === "string") &&
      (limit === undefined ||
        (typeof limit === "number" && Number.isSafeInteger(limit) && limit > 0))
    );
  }
  if (value.type === "GET_BOOKMARK") {
    return isRecord(value.payload) && isBookmarkId(value.payload.id);
  }
  if (value.type === "GET_BOOKMARK_DECORATIONS") {
    return (
      isRecord(value.payload) &&
      Array.isArray(value.payload.ids) &&
      value.payload.ids.length > 0 &&
      value.payload.ids.length <= 100 &&
      value.payload.ids.every(isBookmarkId)
    );
  }
  if (value.type === "SAVE_BOOKMARK_NOTE") {
    return (
      isRecord(value.payload) &&
      isBookmarkId(value.payload.id) &&
      typeof value.payload.note === "string" &&
      value.payload.note.length <= 20_000
    );
  }
  if (value.type === "ADD_BOOKMARK_TAG") {
    return (
      isRecord(value.payload) &&
      isBookmarkId(value.payload.id) &&
      typeof value.payload.name === "string" &&
      value.payload.name.length <= 200 &&
      value.payload.name.trim().length > 0 &&
      value.payload.name.trim().normalize("NFKC").length <= 50
    );
  }
  if (value.type === "REMOVE_BOOKMARK_TAG") {
    return (
      isRecord(value.payload) &&
      isBookmarkId(value.payload.id) &&
      isLocalEntityId(value.payload.tagId)
    );
  }
  if (value.type === "CREATE_FOLDER") {
    return (
      isRecord(value.payload) &&
      isFolderName(value.payload.name) &&
      (value.payload.parentId === null || isLocalEntityId(value.payload.parentId))
    );
  }
  if (value.type === "RENAME_FOLDER") {
    return (
      isRecord(value.payload) &&
      isLocalEntityId(value.payload.id) &&
      isFolderName(value.payload.name)
    );
  }
  if (value.type === "DELETE_FOLDER") {
    return isRecord(value.payload) && isLocalEntityId(value.payload.id);
  }
  if (value.type === "ASSIGN_BOOKMARK_FOLDER") {
    return (
      isRecord(value.payload) &&
      isBookmarkId(value.payload.bookmarkId) &&
      (value.payload.folderId === null || isLocalEntityId(value.payload.folderId))
    );
  }
  if (value.type !== "EXPORT_BOOKMARKS" || !isRecord(value.payload)) return false;
  const { format, locale } = value.payload;
  return (format === "full" || format === "urls") && isSupportedLocale(locale);
}

function isBookmarkSnapshot(value: unknown): value is BookmarkSnapshot {
  if (!isRecord(value) || !isRecord(value.author)) return false;
  let statusUrlIsValid = false;
  if (typeof value.url === "string") {
    try {
      const url = new URL(value.url);
      const match = url.pathname.match(/^\/[A-Za-z0-9_]+\/status\/(\d+)$/);
      statusUrlIsValid =
        url.protocol === "https:" &&
        (url.hostname === "x.com" || url.hostname === "www.x.com") &&
        url.username === "" &&
        url.password === "" &&
        url.port === "" &&
        url.search === "" &&
        url.hash === "" &&
        typeof value.id === "string" &&
        match?.[1] === value.id;
    } catch {
      statusUrlIsValid = false;
    }
  }
  return (
    typeof value.id === "string" &&
    /^\d+$/.test(value.id) &&
    typeof value.text === "string" &&
    statusUrlIsValid &&
    (value.media === undefined || isBookmarkMedia(value.media, value.url as string)) &&
    typeof value.postCreatedAt === "string" &&
    typeof value.author.id === "string" &&
    typeof value.author.username === "string" &&
    typeof value.author.name === "string"
  );
}

function isContentEvent(value: unknown): value is ContentEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "LIVE_BOOKMARK_CANCELLED") {
    return typeof value.intentId === "string" && value.intentId.length <= 128;
  }
  if (
    value.type === "LIVE_BOOKMARK_PENDING" ||
    value.type === "LIVE_BOOKMARK_CONFIRMED"
  ) {
    return (
      typeof value.intentId === "string" &&
      value.intentId.length <= 128 &&
      (value.action === "save" || value.action === "remove") &&
      isBookmarkSnapshot(value.bookmark)
    );
  }
  if (typeof value.runId !== "string") return false;
  if (value.type === "SCRAPE_BATCH") {
    return (
      Array.isArray(value.bookmarks) &&
      value.bookmarks.length <= 100 &&
      value.bookmarks.every(isBookmarkSnapshot)
    );
  }
  if (value.type === "SCRAPE_PROGRESS") {
    return typeof value.fetched === "number" && Number.isSafeInteger(value.fetched);
  }
  if (value.type === "SCRAPE_COMPLETE") {
    return (
      (value.status === "completed" || value.status === "cancelled") &&
      typeof value.fetched === "number" &&
      Number.isSafeInteger(value.fetched) &&
      (value.status === "cancelled" || value.completionReason === "stable_end")
    );
  }
  return value.type === "SCRAPE_FAILED" && typeof value.errorCode === "string";
}

function isLiveBookmarkEvent(event: ContentEvent): event is LiveBookmarkEvent {
  return (
    event.type === "LIVE_BOOKMARK_PENDING" ||
    event.type === "LIVE_BOOKMARK_CONFIRMED" ||
    event.type === "LIVE_BOOKMARK_CANCELLED"
  );
}

function success<T>(data: T): RuntimeResponse<T> {
  return { ok: true, data };
}

function failure(error: unknown): RuntimeResponse<never> {
  if (error instanceof BackupValidationError) {
    return {
      ok: false,
      error: { code: "invalid_backup", message: error.message },
    };
  }
  if (error instanceof BackupSettingsWriteError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        recovery: { dataRestored: true, reloadRequired: true },
      },
    };
  }
  if (error instanceof BookmarkXError) {
    return { ok: false, error: { code: error.code, message: error.message } };
  }
  return {
    ok: false,
    error: {
      code: "internal_error",
      message: "Bookmark X could not complete the request.",
    },
  };
}

function exportFilename(now: Date, format: "full" | "urls"): string {
  const timestamp = now
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d{3}Z$/, "Z");
  return `bookmark-x-${timestamp}-${format}.txt`;
}

export class BackgroundController {
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(private readonly dependencies: BackgroundDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.createId = dependencies.createId ?? (() => crypto.randomUUID());
  }

  async handle(
    request: unknown,
    sender: MessageSender = {},
  ): Promise<RuntimeResponse<unknown>> {
    if (isContentEvent(request)) {
      return this.handleContentEvent(request, sender);
    }
    if (!isUiRequest(request) || sender.id !== this.dependencies.extensionId) {
      return failure(
        new BookmarkXError("invalid_request", "The extension request is invalid."),
      );
    }

    try {
      switch (request.type) {
        case "GET_STATUS":
          return success(await this.getStatus());
        case "GET_SETTINGS":
          return success({ settings: await this.dependencies.settings.get() });
        case "GET_SEMANTIC_CORPUS":
          return success({ documents: await this.dependencies.search.listDocuments() });
        case "SAVE_SETTINGS": {
          const settings = await this.dependencies.settings.save(
            request.payload.settings,
          );
          await this.dependencies.browser.configureSurface(settings.behavior.surface);
          return success({ settings });
        }
        case "OPEN_SELECTED_SURFACE": {
          const settings = await this.dependencies.settings.get();
          if (settings.behavior.surface === "modal") {
            return success({ surface: "modal", opened: false });
          }
          const tabId = sender.tab?.id;
          if (
            typeof tabId !== "number" ||
            !isBookmarksUrl(sender.tab?.url ?? sender.url)
          ) {
            throw new BookmarkXError(
              "invalid_sender",
              "The surface request must come from an X bookmarks tab.",
            );
          }
          await this.dependencies.browser.openSidePanel(tabId);
          return success({ surface: "sidePanel", opened: true });
        }
        case "LIST_BOOKMARKS": {
          const view = request.payload?.view ?? "current";
          const limit = Math.min(request.payload?.limit ?? 50, 100);
          const cursor = request.payload?.cursor;
          return success(
            await this.dependencies.bookmarks.list({
              view,
              limit,
              ...(cursor === undefined ? {} : { cursor }),
            }),
          );
        }
        case "SEARCH_BOOKMARKS": {
          const limit = Math.min(request.payload.limit ?? 50, 100);
          const cursor = request.payload.cursor;
          return success(
            await this.dependencies.search.search({
              query: request.payload.query,
              view: request.payload.view,
              limit,
              ...(cursor === undefined ? {} : { cursor }),
            }),
          );
        }
        case "GET_BOOKMARK":
          return success({
            bookmark: await this.dependencies.bookmarks.get(request.payload.id),
          });
        case "GET_BOOKMARK_DECORATIONS": {
          const ids = [...new Set(request.payload.ids)];
          const [bookmarks, rawTags, rawFolders, settings, localization] =
            await Promise.all([
              this.dependencies.bookmarks.getMany(ids),
              this.dependencies.tags.list(),
              this.dependencies.folders.list(),
              this.dependencies.settings.get(),
              this.dependencies.locale.get(),
            ]);
          const tags = rawTags as BookmarkTag[];
          const folders = rawFolders as FolderRecord[];
          const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
          return success({
            ...localization,
            settings,
            items: bookmarks.map((bookmark) => ({
              bookmark,
              breadcrumb: folderBreadcrumb(bookmark.folderId, folders).map(
                (folder) => folder.name,
              ),
              tags: bookmark.tagIds
                .map((tagId) => tagsById.get(tagId))
                .filter((tag): tag is BookmarkTag => tag !== undefined),
            })),
          });
        }
        case "SAVE_BOOKMARK_NOTE": {
          const bookmark = await this.dependencies.bookmarks.saveNote(
            request.payload.id,
            request.payload.note,
          );
          this.dependencies.search.invalidate();
          return success({ bookmark });
        }
        case "LIST_TAGS":
          return success({ tags: await this.dependencies.tags.list() });
        case "ADD_BOOKMARK_TAG": {
          const result = await this.dependencies.tags.add(
            request.payload.id,
            request.payload.name,
          );
          this.dependencies.search.invalidate();
          return success(result);
        }
        case "REMOVE_BOOKMARK_TAG": {
          const bookmark = await this.dependencies.tags.remove(
            request.payload.id,
            request.payload.tagId,
          );
          this.dependencies.search.invalidate();
          return success({ bookmark });
        }
        case "LIST_FOLDERS":
          return success({ folders: await this.dependencies.folders.list() });
        case "CREATE_FOLDER": {
          const folder = await this.dependencies.folders.create(request.payload);
          this.dependencies.search.invalidate();
          return success({ folder });
        }
        case "RENAME_FOLDER": {
          const folder = await this.dependencies.folders.rename(
            request.payload.id,
            request.payload.name,
          );
          this.dependencies.search.invalidate();
          return success({ folder });
        }
        case "DELETE_FOLDER": {
          const result = await this.dependencies.folders.delete(request.payload.id);
          this.dependencies.search.invalidate();
          return success(result);
        }
        case "ASSIGN_BOOKMARK_FOLDER": {
          const bookmark = await this.dependencies.folders.assignBookmark(
            request.payload.bookmarkId,
            request.payload.folderId,
          );
          this.dependencies.search.invalidate();
          return success({ bookmark });
        }
        case "OPEN_BOOKMARKS":
          await this.dependencies.browser.openBookmarks();
          return success(null);
        case "START_SCRAPE":
          return success(await this.startScrape());
        case "CANCEL_SCRAPE":
          return success(await this.cancelScrape());
        case "CLEAR_ARCHIVE":
          await this.dependencies.archive.clear();
          await this.dependencies.state.clearScrapeRun();
          this.dependencies.search.invalidate();
          return success(null);
        case "EXPORT_BACKUP":
          return success(await this.dependencies.backup.export());
        case "RESTORE_BACKUP": {
          const run = await this.dependencies.state.getScrapeRun();
          if (run?.status === "running") {
            throw new BookmarkXError(
              "restore_capture_running",
              "Wait for the active capture to finish before restoring a backup.",
            );
          }
          try {
            const restored = await this.dependencies.backup.restore(
              request.payload.content,
              request.payload.mode,
            );
            this.dependencies.search.invalidate();
            await this.dependencies.state.clearScrapeRun();
            try {
              const settings = await this.dependencies.settings.get();
              await this.dependencies.browser.configureSurface(
                settings.behavior.surface,
              );
            } catch {
              // The canonical setting is already stored. The reload signal lets
              // Chrome rehydrate the surface without making a committed restore
              // look retryable because a disposable UI refresh failed.
            }
            return success(restored);
          } catch (error) {
            if (error instanceof BackupSettingsWriteError) {
              this.dependencies.search.invalidate();
              await this.dependencies.state.clearScrapeRun();
            }
            throw error;
          }
        }
        case "EXPORT_BOOKMARKS":
          return success(await this.createExport(request));
      }
    } catch (error) {
      return failure(error);
    }
  }

  private async getStatus(): Promise<PopupStatus> {
    const [tab, stats, scrape] = await Promise.all([
      this.dependencies.browser.getActiveTab(),
      this.dependencies.archive.getStats(),
      this.dependencies.state.getScrapeRun(),
    ]);
    return {
      pageReady: isBookmarksUrl(tab?.url),
      stats,
      scrape,
    };
  }

  private async startScrape(): Promise<ScrapeRun> {
    const previous = await this.dependencies.state.getScrapeRun();
    if (previous?.status === "running") {
      throw new BookmarkXError(
        "scrape_in_progress",
        "A bookmark capture is already running.",
      );
    }

    const tab = await this.dependencies.browser.getActiveTab();
    if (!tab || !isBookmarksUrl(tab.url)) {
      throw new BookmarkXError(
        "bookmarks_page_required",
        "Open the X bookmarks page before starting capture.",
      );
    }

    const timestamp = this.now().toISOString();
    const run: ScrapeRun = {
      id: this.createId(),
      tabId: tab.id,
      status: "running",
      fetched: 0,
      added: 0,
      updated: 0,
      startedAt: timestamp,
      updatedAt: timestamp,
      errorCode: null,
    };
    await this.dependencies.state.setScrapeRun(run);
    try {
      const response = await this.dependencies.browser.sendToTab(tab.id, {
        type: "START_SCRAPE",
        runId: run.id,
      });
      if (!isRecord(response) || response.accepted !== true) {
        throw new Error("The content script did not accept capture.");
      }
    } catch {
      const failed = {
        ...run,
        status: "error" as const,
        errorCode: "content_script_unavailable",
        updatedAt: this.now().toISOString(),
      };
      await this.dependencies.state.setScrapeRun(failed);
      throw new BookmarkXError(
        "content_script_unavailable",
        "Reload the X bookmarks page and try again.",
      );
    }
    return run;
  }

  private async cancelScrape(): Promise<ScrapeRun | null> {
    const run = await this.dependencies.state.getScrapeRun();
    if (!run || run.status !== "running") return run;
    try {
      await this.dependencies.browser.sendToTab(run.tabId, {
        type: "CANCEL_SCRAPE",
        runId: run.id,
      });
    } catch {
      // The tab may have closed; the local run can still be cancelled safely.
    }
    const cancelled: ScrapeRun = {
      ...run,
      status: "cancelled",
      updatedAt: this.now().toISOString(),
    };
    await this.dependencies.state.setScrapeRun(cancelled);
    await this.dependencies.archive.discardCapture(run.id);
    return cancelled;
  }

  private async handleContentEvent(
    event: ContentEvent,
    sender: MessageSender,
  ): Promise<RuntimeResponse<unknown>> {
    if (isLiveBookmarkEvent(event)) {
      return this.handleLiveBookmarkEvent(event, sender);
    }
    if (
      sender.id !== this.dependencies.extensionId ||
      !isBookmarksUrl(sender.tab?.url ?? sender.url)
    ) {
      return failure(
        new BookmarkXError("invalid_sender", "The capture message was rejected."),
      );
    }

    try {
      const run = await this.dependencies.state.getScrapeRun();
      if (
        !run ||
        run.id !== event.runId ||
        run.tabId !== sender.tab?.id ||
        run.status !== "running"
      ) {
        throw new BookmarkXError("stale_capture", "This capture is no longer active.");
      }

      const timestamp = this.now().toISOString();
      if (event.type === "SCRAPE_BATCH") {
        const merged = await this.dependencies.archive.mergeBookmarks(
          event.bookmarks,
          run.id,
          timestamp,
        );
        this.dependencies.search.invalidate();
        const updated: ScrapeRun = {
          ...run,
          fetched: run.fetched + event.bookmarks.length,
          added: run.added + merged.added,
          updated: run.updated + merged.updated,
          updatedAt: timestamp,
        };
        await this.dependencies.state.setScrapeRun(updated);
        return success(updated);
      }

      if (event.type === "SCRAPE_PROGRESS") {
        const updated = {
          ...run,
          fetched: Math.max(run.fetched, event.fetched),
          updatedAt: timestamp,
        };
        await this.dependencies.state.setScrapeRun(updated);
        return success(updated);
      }

      if (event.type === "SCRAPE_FAILED") {
        const failed: ScrapeRun = {
          ...run,
          status: "error",
          errorCode: event.errorCode.slice(0, 80),
          updatedAt: timestamp,
        };
        await this.dependencies.state.setScrapeRun(failed);
        await this.dependencies.archive.discardCapture(run.id);
        return success(failed);
      }

      const completed: ScrapeRun = {
        ...run,
        status: event.status,
        fetched: Math.max(run.fetched, event.fetched),
        updatedAt: timestamp,
      };
      if (event.status === "completed") {
        const settings = await this.dependencies.settings.get();
        await this.dependencies.archive.finalizeCapture(
          run.id,
          timestamp,
          settings.data.keepArchived,
        );
        this.dependencies.search.invalidate();
      }
      await this.dependencies.state.setScrapeRun(completed);
      if (event.status === "cancelled") {
        await this.dependencies.archive.discardCapture(run.id);
      }
      return success(completed);
    } catch (error) {
      return failure(error);
    }
  }

  private async handleLiveBookmarkEvent(
    event: LiveBookmarkEvent,
    sender: MessageSender,
  ): Promise<RuntimeResponse<unknown>> {
    const tabId = sender.tab?.id;
    if (
      sender.id !== this.dependencies.extensionId ||
      typeof tabId !== "number" ||
      !isXUrl(sender.tab?.url ?? sender.url)
    ) {
      return failure(
        new BookmarkXError("invalid_sender", "The live bookmark message was rejected."),
      );
    }

    try {
      const timestamp = this.now().toISOString();
      if (event.type === "LIVE_BOOKMARK_PENDING") {
        const settings = await this.dependencies.settings.get();
        const context: LiveBookmarkContext = {
          intentId: event.intentId,
          action: event.action,
          state: "pending",
          bookmark: event.bookmark,
          updatedAt: timestamp,
        };
        await this.dependencies.liveState.set(tabId, context);
        const prompt = settings.behavior.promptAfterBookmark;
        const surface = settings.behavior.surface;
        const opened = prompt && surface === "sidePanel";
        if (opened) await this.dependencies.browser.openSidePanel(tabId);
        return success({ prompt, surface, opened });
      }

      const pending = await this.dependencies.liveState.get(tabId, event.intentId);
      if (pending?.intentId !== event.intentId || pending.state !== "pending") {
        throw new BookmarkXError(
          "stale_live_bookmark",
          "This live bookmark action is no longer active.",
        );
      }

      if (event.type === "LIVE_BOOKMARK_CANCELLED") {
        await this.dependencies.liveState.set(tabId, {
          ...pending,
          state: "cancelled",
          updatedAt: timestamp,
        });
        return success(null);
      }

      if (
        pending.action !== event.action ||
        pending.bookmark.id !== event.bookmark.id
      ) {
        throw new BookmarkXError(
          "stale_live_bookmark",
          "The confirmed bookmark does not match the pending action.",
        );
      }

      const bookmark = await this.dependencies.archive.applyLiveBookmark(
        event.bookmark,
        event.action,
        timestamp,
      );
      await this.dependencies.liveState.set(tabId, {
        ...pending,
        bookmark: event.bookmark,
        action: event.action,
        state: event.action === "save" ? "saved" : "archived",
        updatedAt: timestamp,
      });
      return success({ bookmark });
    } catch (error) {
      return failure(error);
    }
  }

  private async createExport(
    request: Extract<UiRequest, { type: "EXPORT_BOOKMARKS" }>,
  ): Promise<ExportResult> {
    const bookmarks: BookmarkRecord[] = await this.dependencies.archive.getAll();
    return {
      content: exportBookmarks(bookmarks, request.payload),
      filename: exportFilename(this.now(), request.payload.format),
    };
  }
}
