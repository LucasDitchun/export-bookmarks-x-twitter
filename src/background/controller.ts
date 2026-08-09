import { exportBookmarks } from "../domain/export-bookmarks";
import {
  isSupportedLocale,
  type BookmarkRecord,
  type BookmarkSnapshot,
  type ScrapeRun,
} from "../domain/types";
import type {
  ContentControlRequest,
  ContentEvent,
  ExportResult,
  PopupStatus,
  RuntimeResponse,
  UiRequest,
  BookmarkView,
} from "../shared/protocol";
import { BookmarkXError } from "../shared/errors";
import type { ArchiveRepository } from "../storage/archive-repository";
import type { ExtensionStateRepository } from "../storage/extension-state";

interface ActiveTab {
  id: number;
  url?: string | undefined;
}

interface BrowserBridge {
  getActiveTab(): Promise<ActiveTab | null>;
  openBookmarks(): Promise<void>;
  sendToTab(tabId: number, request: ContentControlRequest): Promise<unknown>;
}

interface MessageSender {
  id?: string | undefined;
  url?: string | undefined;
  tab?: { id?: number | undefined; url?: string | undefined } | undefined;
}

interface BackgroundDependencies {
  archive: Pick<
    ArchiveRepository,
    "mergeBookmarks" | "finalizeCapture" | "getAll" | "getStats" | "clear"
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
    saveNote(id: string, note: string): Promise<unknown>;
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

function isUiRequest(value: unknown): value is UiRequest {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (
    value.type === "GET_STATUS" ||
    value.type === "OPEN_BOOKMARKS" ||
    value.type === "START_SCRAPE" ||
    value.type === "CANCEL_SCRAPE" ||
    value.type === "CLEAR_ARCHIVE"
  ) {
    return true;
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
  if (value.type === "GET_BOOKMARK") {
    return isRecord(value.payload) && isBookmarkId(value.payload.id);
  }
  if (value.type === "SAVE_BOOKMARK_NOTE") {
    return (
      isRecord(value.payload) &&
      isBookmarkId(value.payload.id) &&
      typeof value.payload.note === "string" &&
      value.payload.note.length <= 20_000
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
      statusUrlIsValid =
        (url.hostname === "x.com" || url.hostname === "www.x.com") &&
        /^\/[A-Za-z0-9_]+\/status\/\d+$/.test(url.pathname);
    } catch {
      statusUrlIsValid = false;
    }
  }
  return (
    typeof value.id === "string" &&
    /^\d+$/.test(value.id) &&
    typeof value.text === "string" &&
    statusUrlIsValid &&
    typeof value.postCreatedAt === "string" &&
    typeof value.author.id === "string" &&
    typeof value.author.username === "string" &&
    typeof value.author.name === "string"
  );
}

function isContentEvent(value: unknown): value is ContentEvent {
  if (
    !isRecord(value) ||
    typeof value.type !== "string" ||
    typeof value.runId !== "string"
  ) {
    return false;
  }
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
      Number.isSafeInteger(value.fetched)
    );
  }
  return value.type === "SCRAPE_FAILED" && typeof value.errorCode === "string";
}

function success<T>(data: T): RuntimeResponse<T> {
  return { ok: true, data };
}

function failure(error: unknown): RuntimeResponse<never> {
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
        case "GET_BOOKMARK":
          return success({
            bookmark: await this.dependencies.bookmarks.get(request.payload.id),
          });
        case "SAVE_BOOKMARK_NOTE":
          return success({
            bookmark: await this.dependencies.bookmarks.saveNote(
              request.payload.id,
              request.payload.note,
            ),
          });
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
          return success(null);
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
    return cancelled;
  }

  private async handleContentEvent(
    event: ContentEvent,
    sender: MessageSender,
  ): Promise<RuntimeResponse<unknown>> {
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
        return success(failed);
      }

      const completed: ScrapeRun = {
        ...run,
        status: event.status,
        fetched: Math.max(run.fetched, event.fetched),
        updatedAt: timestamp,
      };
      if (event.status === "completed") {
        await this.dependencies.archive.finalizeCapture(run.id, timestamp);
      }
      await this.dependencies.state.setScrapeRun(completed);
      return success(completed);
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
