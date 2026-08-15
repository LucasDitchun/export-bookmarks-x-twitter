import type {
  BookmarkDecorationLookupResult,
  BookmarkDecorationItem,
  ContentControlRequest,
  ContentEvent,
  FirstUseDisclosureResult,
  RuntimeResponse,
  UiRequest,
} from "../shared/protocol";
import { extractBookmarks } from "./extract-bookmarks";
import { hasReachedPageEnd, isPageLoading } from "./page-state";
import { runScrape } from "./scrape-runner";
import { isQuickStopThreshold, MAX_QUICK_CHECKPOINTS } from "../domain/quick-update";
import { advanceTimeline } from "./timeline-navigation";
import { waitForTimelineUpdate } from "./timeline-waiter";
import { startLiveBookmarkObserver } from "./live-bookmark-observer";
import { startBookmarkMetadataDecorator } from "./bookmark-metadata-decorator";
import { createBookmarkModal } from "../surfaces/bookmark-modal";
import { loadBookmarkMetadataDraft, saveBookmarkMetadata } from "./bookmark-metadata";
import { isSupportedLocale } from "../domain/types";
import { createPostProcessingConsentGate } from "./post-processing-consent";

let activeCapture: { runId: string; controller: AbortController } | undefined;
let activeOrganizer: {
  abort: AbortController;
  destroy(): void;
  setLocalization(messages: Record<string, string>): void;
} | null = null;

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

async function capture(
  runId: string,
  controller: AbortController,
  checkpointIds: readonly string[],
  quickStopThreshold: number,
): Promise<void> {
  try {
    const result = await runScrape({
      scan: () => extractBookmarks(document),
      checkpointIds,
      quickStopThreshold,
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
        completionReason: result.completionReason ?? "stable_end",
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
  if (request.type === "ENABLE_POST_PROCESSING") return true;
  if (request.type === "REFRESH_BOOKMARK_LOCALIZATION") {
    const localization = request.localization;
    return (
      typeof localization === "object" &&
      localization !== null &&
      isSupportedLocale((localization as Record<string, unknown>).locale) &&
      typeof (localization as Record<string, unknown>).messages === "object" &&
      (localization as Record<string, unknown>).messages !== null
    );
  }
  if (request.type === "REFRESH_BOOKMARK_METADATA") {
    return (
      request.bookmarkIds === undefined ||
      (Array.isArray(request.bookmarkIds) &&
        request.bookmarkIds.length <= 100 &&
        request.bookmarkIds.every(
          (bookmarkId) => typeof bookmarkId === "string" && /^\d+$/.test(bookmarkId),
        ))
    );
  }

  if (typeof request.runId !== "string") return false;
  if (request.type === "CANCEL_SCRAPE") return true;
  if (request.type !== "START_SCRAPE") return false;
  if (request.mode !== "quick" && request.mode !== "full") return false;
  if (
    !Array.isArray(request.checkpointIds) ||
    request.checkpointIds.length > MAX_QUICK_CHECKPOINTS ||
    !isQuickStopThreshold(request.quickStopThreshold)
  ) {
    return false;
  }
  return (
    request.checkpointIds.every((id) => typeof id === "string" && /^\d+$/.test(id)) &&
    new Set(request.checkpointIds).size === request.checkpointIds.length
  );
}

function startPostProcessing() {
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
    onOrganize(item: BookmarkDecorationItem, translate) {
      activeOrganizer?.destroy();
      const abort = new AbortController();
      let currentTranslate = translate;
      const modal = createBookmarkModal({
        document,
        title: currentTranslate("bookmarkPromptTitle"),
        bookmarkTitle: item.bookmark.text || item.bookmark.url,
        labels: {
          close: currentTranslate("bookmarkPromptClose"),
          description: currentTranslate("bookmarkPromptNote"),
          folder: currentTranslate("bookmarkPromptFolder"),
          save: currentTranslate("bookmarkPromptSave"),
          tags: currentTranslate("bookmarkPromptTags"),
          tagsHelp: currentTranslate("bookmarkPromptTagsHelp"),
          pending: currentTranslate("liveBookmarkPending"),
        },
        onSave: async (values) => {
          modal.setState("pending", currentTranslate("liveBookmarkPending"));
          try {
            await saveBookmarkMetadata({
              bookmark: item.bookmark,
              values,
              send: (request: UiRequest) => chrome.runtime.sendMessage(request),
              signal: abort.signal,
            });
            modal.setState("ready", currentTranslate("liveBookmarkSaved"));
            metadataDecorator.refresh(item.bookmark.id);
            return true;
          } catch {
            if (!abort.signal.aborted) {
              modal.setState("ready", currentTranslate("liveBookmarkFailed"));
            }
            return false;
          }
        },
        onClose: () => {
          abort.abort();
          modal.destroy();
          if (activeOrganizer?.abort === abort) activeOrganizer = null;
        },
      });
      activeOrganizer = {
        abort,
        setLocalization(messages) {
          currentTranslate = (key) => messages[key] ?? key;
          modal.setLabels({
            title: currentTranslate("bookmarkPromptTitle"),
            labels: {
              close: currentTranslate("bookmarkPromptClose"),
              description: currentTranslate("bookmarkPromptNote"),
              folder: currentTranslate("bookmarkPromptFolder"),
              save: currentTranslate("bookmarkPromptSave"),
              tags: currentTranslate("bookmarkPromptTags"),
              tagsHelp: currentTranslate("bookmarkPromptTagsHelp"),
              pending: currentTranslate("liveBookmarkPending"),
            },
          });
        },
        destroy() {
          abort.abort();
          modal.destroy();
        },
      };
      modal.open();
      void loadBookmarkMetadataDraft({
        bookmark: item.bookmark,
        send: (request: UiRequest) => chrome.runtime.sendMessage(request),
        signal: abort.signal,
      }).then(
        ({ values, choices }) => {
          if (abort.signal.aborted) return;
          modal.setValues(values);
          modal.setChoices(choices);
          modal.setState("ready", "");
        },
        () => {
          if (!abort.signal.aborted) {
            modal.setState("ready", currentTranslate("liveBookmarkFailed"));
          }
        },
      );
    },
  });

  const liveBookmarkObserver = startLiveBookmarkObserver({
    document,
    send: (event) => chrome.runtime.sendMessage(event),
    translate: (key) => chrome.i18n.getMessage(key) || key,
    onPending: (article, bookmarkId) => {
      void metadataDecorator.setPending(article, bookmarkId);
    },
    onChanged: (bookmarkId) => {
      void metadataDecorator.refresh(bookmarkId);
    },
  });

  return {
    metadataDecorator,
    liveBookmarkObserver,
    stop() {
      liveBookmarkObserver.stop();
      metadataDecorator.stop();
    },
  };
}

let postProcessing: ReturnType<typeof startPostProcessing> | null = null;
const consentGate = createPostProcessingConsentGate({
  async loadAccepted() {
    const response: RuntimeResponse<FirstUseDisclosureResult> =
      await chrome.runtime.sendMessage({ type: "GET_FIRST_USE_DISCLOSURE" });
    return response.ok && response.data.accepted;
  },
  start() {
    const runtime = startPostProcessing();
    postProcessing = runtime;
    return {
      stop() {
        runtime.stop();
        if (postProcessing === runtime) postProcessing = null;
      },
    };
  },
});

chrome.runtime.onMessage.addListener((request: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isControlRequest(request)) {
    sendResponse({ accepted: false });
    return false;
  }

  if (request.type === "ENABLE_POST_PROCESSING") {
    consentGate.enable();
    sendResponse({ accepted: true });
    return false;
  }

  if (!postProcessing) {
    sendResponse({ accepted: false, reason: "first_use_disclosure_required" });
    return false;
  }

  if (request.type === "REFRESH_BOOKMARK_METADATA") {
    postProcessing.metadataDecorator.refresh(request.bookmarkIds);
    sendResponse({ accepted: true });
    return false;
  }

  if (request.type === "REFRESH_BOOKMARK_LOCALIZATION") {
    postProcessing.liveBookmarkObserver.setLocalization(request.localization);
    activeOrganizer?.setLocalization(request.localization.messages);
    postProcessing.metadataDecorator.setLocalization(request.localization);
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
  void capture(
    request.runId,
    controller,
    request.checkpointIds,
    request.quickStopThreshold,
  );
  return false;
});

void consentGate.initialize().catch(() => undefined);

window.addEventListener(
  "pagehide",
  () => {
    activeCapture?.controller.abort();
    activeOrganizer?.destroy();
    consentGate.stop();
  },
  { once: true },
);
