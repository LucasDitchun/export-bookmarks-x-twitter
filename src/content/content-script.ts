import type { ContentControlRequest, ContentEvent } from "../shared/protocol";
import { extractBookmarks } from "./extract-bookmarks";
import { hasReachedPageEnd, isPageLoading } from "./page-state";
import { runScrape } from "./scrape-runner";
import { advanceTimeline } from "./timeline-navigation";
import { waitForTimelineUpdate } from "./timeline-waiter";

let activeCapture: { runId: string; controller: AbortController } | undefined;

function send(event: ContentEvent): Promise<unknown> {
  return chrome.runtime.sendMessage(event);
}

async function capture(runId: string, controller: AbortController): Promise<void> {
  try {
    const result = await runScrape({
      scan: () => extractBookmarks(document),
      isLoading: () => isPageLoading(document),
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
        await send({ type: "SCRAPE_BATCH", runId, bookmarks });
      },
      onProgress: async ({ fetched }) => {
        await send({ type: "SCRAPE_PROGRESS", runId, fetched });
      },
    });
    await send({
      type: "SCRAPE_COMPLETE",
      runId,
      status: result.status,
      fetched: result.fetched,
    });
  } catch {
    await send({
      type: "SCRAPE_FAILED",
      runId,
      errorCode: controller.signal.aborted ? "capture_cancelled" : "scrape_failed",
    });
  } finally {
    if (activeCapture?.runId === runId) {
      activeCapture = undefined;
    }
  }
}

function isControlRequest(value: unknown): value is ContentControlRequest {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Record<string, unknown>;
  return (
    (request.type === "START_SCRAPE" || request.type === "CANCEL_SCRAPE") &&
    typeof request.runId === "string"
  );
}

chrome.runtime.onMessage.addListener((request: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isControlRequest(request)) {
    sendResponse({ accepted: false });
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
