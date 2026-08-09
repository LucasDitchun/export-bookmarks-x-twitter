import type { BookmarkSnapshot } from "../domain/types";

export interface ScrapeProgress {
  fetched: number;
}

export interface ScrapeWaitResult {
  reason: "activity" | "timeout" | "aborted";
  loadingObserved: boolean;
}

export interface ScrapeRunnerOptions {
  scan: () => BookmarkSnapshot[];
  isLoading?: () => boolean;
  isAtEnd?: () => boolean;
  isPageValid?: () => boolean;
  scroll: () => void;
  waitForContent: (signal?: AbortSignal) => Promise<ScrapeWaitResult | void>;
  onBatch: (bookmarks: BookmarkSnapshot[]) => Promise<void>;
  onProgress: (progress: ScrapeProgress) => void | Promise<void>;
  signal?: AbortSignal;
  idlePassLimit?: number;
  maximumLoadingPasses?: number;
  batchSize?: number;
}

export interface ScrapeResult {
  status: "completed" | "cancelled" | "incomplete";
  fetched: number;
  errorCode?: "capture_navigation_changed" | "capture_loading_timeout";
}

export async function runScrape({
  scan,
  isLoading = () => false,
  isAtEnd = () => true,
  isPageValid = () => true,
  scroll,
  waitForContent,
  onBatch,
  onProgress,
  signal,
  idlePassLimit = 4,
  maximumLoadingPasses = 180,
  batchSize = 100,
}: ScrapeRunnerOptions): Promise<ScrapeResult> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new RangeError("Scrape batch size must be between 1 and 100.");
  }
  if (!Number.isSafeInteger(idlePassLimit) || idlePassLimit < 1) {
    throw new RangeError("Idle pass limit must be a positive integer.");
  }
  if (!Number.isSafeInteger(maximumLoadingPasses) || maximumLoadingPasses < 1) {
    throw new RangeError("Loading pass limit must be a positive integer.");
  }
  const seen = new Set<string>();
  let deliveredCount = 0;
  let idlePasses = 0;
  let loadingPasses = 0;
  let lastReportedFetched = -1;

  while (!signal?.aborted) {
    if (!isPageValid()) {
      return {
        status: "incomplete",
        fetched: deliveredCount,
        errorCode: "capture_navigation_changed",
      };
    }
    const batch = scan().filter(({ id }) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    const loading = isLoading();
    const reachedEnd = isAtEnd();

    const quietEndCandidate = batch.length === 0 && !loading && reachedEnd;

    if (batch.length > 0) {
      idlePasses = 0;
      const deliveredBeforeBatch = deliveredCount;
      for (let offset = 0; offset < batch.length; offset += batchSize) {
        if (signal?.aborted) break;
        const chunk = batch.slice(offset, offset + batchSize);
        await onBatch(chunk);
        deliveredCount += chunk.length;
      }
      if (deliveredCount > deliveredBeforeBatch) loadingPasses = 0;
    } else if (loading || !reachedEnd) {
      idlePasses = 0;
    }

    if (lastReportedFetched !== deliveredCount) {
      await onProgress({ fetched: deliveredCount });
      lastReportedFetched = deliveredCount;
    }

    const contentUpdate = waitForContent(signal);
    if (!loading && !quietEndCandidate) {
      scroll();
    }
    const waitResult = await contentUpdate;
    if (!isPageValid()) {
      return {
        status: "incomplete",
        fetched: deliveredCount,
        errorCode: "capture_navigation_changed",
      };
    }
    const loadingAfterWait = isLoading();
    const reachedEndAfterWait = isAtEnd();
    if (loading || waitResult?.loadingObserved || loadingAfterWait) {
      loadingPasses += 1;
      if (loadingPasses >= maximumLoadingPasses) {
        return {
          status: "incomplete",
          fetched: deliveredCount,
          errorCode: "capture_loading_timeout",
        };
      }
    }

    if (
      quietEndCandidate &&
      !signal?.aborted &&
      waitResult?.reason !== "activity" &&
      !waitResult?.loadingObserved &&
      !loadingAfterWait &&
      reachedEndAfterWait
    ) {
      idlePasses += 1;
      if (idlePasses >= idlePassLimit) {
        return { status: "completed", fetched: deliveredCount };
      }
    } else if (
      waitResult?.loadingObserved ||
      waitResult?.reason === "activity" ||
      loadingAfterWait ||
      !reachedEndAfterWait
    ) {
      idlePasses = 0;
    }
  }

  return { status: "cancelled", fetched: deliveredCount };
}
