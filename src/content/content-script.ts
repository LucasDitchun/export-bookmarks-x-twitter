import type {
  BookmarkDecorationLookupResult,
  ContentControlRequest,
  ContentEvent,
  RuntimeResponse,
} from "../shared/protocol";
import { extractBookmarks } from "./extract-bookmarks";
import { hasReachedPageEnd, isPageLoading } from "./page-state";
import { runScrape } from "./scrape-runner";
import { advanceTimeline } from "./timeline-navigation";
import { waitForTimelineUpdate } from "./timeline-waiter";
import { startLiveBookmarkObserver } from "./live-bookmark-observer";
import { startBookmarkMetadataDecorator } from "./bookmark-metadata-decorator";

let activeCapture: { runId: string; controller: AbortController } | undefined;

function send(event: ContentEvent): Promise<unknown> {
  return chrome.runtime.sendMessage(event);
}

class CaptureDeliveryError extends Error {
  constructor(readonly code: string) {
    super(`Capture event was rejected: ${code}`);
  }
}

async function sendCaptureEvent(event: ContentEvent): Promise<void> {
  const response = await send(event);
  if (typeof response !== "object" || response === null) {
    throw new CaptureDeliveryError("invalid_response");
  }
  const envelope = response as Record<string, unknown>;
  if (envelope.ok === true) return;
  const error = envelope.error;
  const code =
    typeof error === "object" &&
    error !== null &&
    typeof (error as Record<string, unknown>).code === "string"
      ? String((error as Record<string, unknown>).code)
      : "rejected";
  throw new CaptureDeliveryError(code);
}

async function capture(runId: string, controller: AbortController): Promise<void> {
  try {
    const result = await runScrape({
      scan: () => extractBookmarks(document),
      isLoading: () => isPageLoading(document),
      isPageValid: () => {
        const location = new URL(window.location.href);
        return (
          (location.hostname === "x.com" || location.hostname === "www.x.com") &&
          (location.pathname === "/i/bookmarks" ||
            location.pathname.startsWith("/i/bookmarks/"))
        );
      },
      isAtEnd: () => {
        const scrollingElement = document.scrollingElement ?? document.documentElement;
        return hasReachedPageEnd({
          scrollTop: Math.max(window.scrollY, scrollingElement.scrollTop),
          viewportHeight: window.innerHeight,
          documentHeight: scrollingElement.scrollHeight,
        });
      },
      scroll: () => {
        advanceTimeline(document, {
          viewportHeight: window.innerHeight,
          scrollBy: () => {
            window.scrollBy({
              top: Math.max(Math.round(window.innerHeight * 0.9), 640),
              behavior: "auto",
            });
          },
        });
      },
      waitForContent: (signal) =>
        waitForTimelineUpdate({
          root: document.querySelector("main") ?? document.body,
          view: window,
          signal,
        }),
      signal: controller.signal,
      onBatch: async (bookmarks) => {
        await sendCaptureEvent({ type: "SCRAPE_BATCH", runId, bookmarks });
      },
      onProgress: async ({ fetched }) => {
        await sendCaptureEvent({ type: "SCRAPE_PROGRESS", runId, fetched });
      },
    });
    if (result.status === "incomplete") {
      await sendCaptureEvent({
        type: "SCRAPE_FAILED",
        runId,
        errorCode: result.errorCode ?? "scrape_incomplete",
      });
      return;
    }
    if (result.status === "completed") {
      await sendCaptureEvent({
        type: "SCRAPE_COMPLETE",
        runId,
        status: "completed",
        fetched: result.fetched,
        completionReason: "stable_end",
      });
      return;
    }
    await sendCaptureEvent({
      type: "SCRAPE_COMPLETE",
      runId,
      status: "cancelled",
      fetched: result.fetched,
    });
  } catch (error) {
    if (error instanceof CaptureDeliveryError && error.code === "stale_capture") {
      return;
    }
    try {
      await send({
        type: "SCRAPE_FAILED",
        runId,
        errorCode: controller.signal.aborted ? "capture_cancelled" : "scrape_failed",
      });
    } catch {
      // Navigation or worker shutdown can make the final best-effort status
      // unreachable. The background never finalizes without stable-end proof.
    }
  } finally {
    if (activeCapture?.runId === runId) {
      activeCapture = undefined;
    }
  }
}

function isControlRequest(value: unknown): value is ContentControlRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Record<string, unknown>;
  if (request.type === "START_SCRAPE" || request.type === "CANCEL_SCRAPE") {
    return typeof request.runId === "string";
  }
  return (
    request.type === "REFRESH_BOOKMARK_METADATA" &&
    (request.bookmarkIds === undefined ||
      (Array.isArray(request.bookmarkIds) &&
        request.bookmarkIds.length <= 100 &&
        request.bookmarkIds.every(
          (bookmarkId) => typeof bookmarkId === "string" && /^\d+$/.test(bookmarkId),
        )))
  );
}

const metadataDecorator = startBookmarkMetadataDecorator({
  document,
  async lookup(ids) {
    const response: RuntimeResponse<BookmarkDecorationLookupResult> =
      await chrome.runtime.sendMessage({
        type: "GET_BOOKMARK_DECORATIONS",
        payload: { ids },
      });
    if (!response.ok) throw new Error(response.error.message);
    return response.data;
  },
});

chrome.runtime.onMessage.addListener((request: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isControlRequest(request)) {
    sendResponse({ accepted: false });
    return false;
  }

  if (request.type === "REFRESH_BOOKMARK_METADATA") {
    if (request.bookmarkIds) {
      for (const bookmarkId of request.bookmarkIds) {
        metadataDecorator.refresh(bookmarkId);
      }
    } else {
      metadataDecorator.refresh();
    }
    sendResponse({ accepted: true });
    return false;
  }

  if (request.type === "CANCEL_SCRAPE") {
    if (activeCapture?.runId === request.runId) {
      activeCapture.controller.abort();
    }
    sendResponse({ accepted: true });
    return false;
  }

  if (activeCapture) {
    sendResponse({ accepted: false, reason: "capture_in_progress" });
    return false;
  }

  const controller = new AbortController();
  activeCapture = { runId: request.runId, controller };
  sendResponse({ accepted: true });
  void capture(request.runId, controller);
  return false;
});

const liveBookmarkObserver = startLiveBookmarkObserver({
  document,
  send: (event) => chrome.runtime.sendMessage(event),
  translate: (key) => chrome.i18n.getMessage(key) || key,
  onPending: (article, bookmarkId) => metadataDecorator.setPending(article, bookmarkId),
  onChanged: (bookmarkId) => metadataDecorator.refresh(bookmarkId),
});

window.addEventListener(
  "pagehide",
  () => {
    activeCapture?.controller.abort();
    liveBookmarkObserver.stop();
    metadataDecorator.stop();
  },
  { once: true },
);
