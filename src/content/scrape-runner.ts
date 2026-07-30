import type { BookmarkSnapshot } from "../domain/types";

export interface ScrapeProgress {
  fetched: number;
}

export interface ScrapeRunnerOptions {
  scan: () => BookmarkSnapshot[];
  isLoading?: () => boolean;
  isAtEnd?: () => boolean;
  scroll: () => void;
  waitForContent: (signal?: AbortSignal) => Promise<void>;
  onBatch: (bookmarks: BookmarkSnapshot[]) => Promise<void>;
  onProgress: (progress: ScrapeProgress) => void | Promise<void>;
  signal?: AbortSignal;
  idlePassLimit?: number;
}

export interface ScrapeResult {
  status: "completed" | "cancelled";
  fetched: number;
}

export async function runScrape({
  scan,
  isLoading = () => false,
  isAtEnd = () => true,
  scroll,
  waitForContent,
  onBatch,
  onProgress,
  signal,
  idlePassLimit = 4,
}: ScrapeRunnerOptions): Promise<ScrapeResult> {
  const seen = new Set<string>();
  let idlePasses = 0;

  while (!signal?.aborted) {
    const batch = scan().filter(({ id }) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    const loading = isLoading();
    const reachedEnd = isAtEnd();

    if (batch.length > 0) {
      idlePasses = 0;
      await onBatch(batch);
    } else if (loading || !reachedEnd) {
      idlePasses = 0;
    } else {
      idlePasses += 1;
    }

    await onProgress({ fetched: seen.size });
    if (idlePasses >= idlePassLimit) {
      return { status: "completed", fetched: seen.size };
    }

    const contentUpdate = waitForContent(signal);
    if (!loading) {
      scroll();
    }
    await contentUpdate;
  }

  return { status: "cancelled", fetched: seen.size };
}
