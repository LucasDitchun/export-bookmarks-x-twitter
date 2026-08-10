import { isPageLoading } from "./page-state";
import type { ScrapeWaitResult } from "./scrape-runner";

const STATUS_LINK_SELECTOR = 'article[data-testid="tweet"] a[href*="/status/"]';
const LOADING_HINT_SELECTOR =
  '[role="progressbar"], [data-testid="progressBar"], [aria-busy="true"]';

function recordsContainLoader(records: readonly MutationRecord[]): boolean {
  return records.some((record) =>
    Array.from(record.addedNodes).some((node) => {
      if (node.nodeType !== 1) return false;
      const element = node as Element;
      return (
        element.matches(LOADING_HINT_SELECTOR) ||
        element.querySelector(LOADING_HINT_SELECTOR) !== null
      );
    }),
  );
}

export interface TimelineWaitOptions {
  root: HTMLElement;
  view: Window & typeof globalThis;
  signal?: AbortSignal | undefined;
  settleMs?: number;
  scrollSettleMs?: number;
  maximumWaitMs?: number;
}

function timelineFingerprint(root: HTMLElement): string {
  const statusLinks = Array.from(
    root.querySelectorAll<HTMLAnchorElement>(STATUS_LINK_SELECTOR),
    (anchor) => anchor.getAttribute("href") ?? "",
  );
  return `${isPageLoading(root.ownerDocument) ? "loading" : "idle"}|${statusLinks.join("|")}`;
}

export function waitForTimelineUpdate({
  root,
  view,
  signal,
  settleMs = 75,
  scrollSettleMs = 180,
  maximumWaitMs = 1_100,
}: TimelineWaitOptions): Promise<ScrapeWaitResult> {
  if (signal?.aborted) {
    return Promise.resolve({ reason: "aborted", loadingObserved: false });
  }

  return new Promise((resolve) => {
    const initialFingerprint = timelineFingerprint(root);
    let loadingObserved = isPageLoading(root.ownerDocument);
    let settled = false;
    let settleTimer: number | undefined;

    const finish = (reason: ScrapeWaitResult["reason"]) => {
      if (settled) return;
      settled = true;
      const pendingRecords = observer.takeRecords();
      const pendingLoader = recordsContainLoader(pendingRecords);
      loadingObserved ||= pendingLoader || isPageLoading(root.ownerDocument);
      observer.disconnect();
      if (settleTimer !== undefined) view.clearTimeout(settleTimer);
      view.clearTimeout(maximumTimer);
      view.removeEventListener("scroll", handleScroll);
      signal?.removeEventListener("abort", handleAbort);
      resolve({
        reason: reason === "timeout" && pendingLoader ? "activity" : reason,
        loadingObserved,
      });
    };
    const scheduleFinish = (reason: ScrapeWaitResult["reason"], delay: number) => {
      if (settleTimer !== undefined) view.clearTimeout(settleTimer);
      settleTimer = view.setTimeout(() => finish(reason), delay);
    };
    const checkTimeline = (records: MutationRecord[]) => {
      const loaderMutation = recordsContainLoader(records);
      loadingObserved ||= loaderMutation || isPageLoading(root.ownerDocument);
      if (loaderMutation) {
        scheduleFinish("activity", settleMs);
        return;
      }
      if (timelineFingerprint(root) !== initialFingerprint) {
        scheduleFinish("activity", settleMs);
      }
    };
    const handleScroll = () => scheduleFinish("activity", scrollSettleMs);
    const handleAbort = () => finish("aborted");

    const observer = new view.MutationObserver(checkTimeline);
    observer.observe(root, {
      attributes: true,
      attributeFilter: [
        "aria-busy",
        "aria-hidden",
        "data-testid",
        "hidden",
        "href",
        "style",
      ],
      childList: true,
      subtree: true,
    });
    view.addEventListener("scroll", handleScroll, { passive: true });
    const maximumTimer = view.setTimeout(() => finish("timeout"), maximumWaitMs);
    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}
