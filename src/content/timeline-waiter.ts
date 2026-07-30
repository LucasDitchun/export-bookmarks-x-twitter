import { isPageLoading } from "./page-state";

const STATUS_LINK_SELECTOR = 'article[data-testid="tweet"] a[href*="/status/"]';

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
}: TimelineWaitOptions): Promise<void> {
  if (signal?.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const initialFingerprint = timelineFingerprint(root);
    let settled = false;
    let settleTimer: number | undefined;

    const finish = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      if (settleTimer !== undefined) view.clearTimeout(settleTimer);
      view.clearTimeout(maximumTimer);
      view.removeEventListener("scroll", handleScroll);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const scheduleFinish = (delay: number) => {
      if (settleTimer !== undefined) view.clearTimeout(settleTimer);
      settleTimer = view.setTimeout(finish, delay);
    };
    const checkTimeline = () => {
      if (timelineFingerprint(root) !== initialFingerprint) {
        scheduleFinish(settleMs);
      }
    };
    const handleScroll = () => scheduleFinish(scrollSettleMs);

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
    const maximumTimer = view.setTimeout(finish, maximumWaitMs);
    signal?.addEventListener("abort", finish, { once: true });
  });
}
