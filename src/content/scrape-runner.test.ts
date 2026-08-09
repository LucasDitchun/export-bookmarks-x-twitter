import { describe, expect, it, vi } from "vitest";

import type { BookmarkSnapshot } from "../domain/types";
import { runScrape } from "./scrape-runner";

function bookmark(id: string): BookmarkSnapshot {
  return {
    id,
    text: `Post ${id}`,
    url: `https://x.com/person/status/${id}`,
    author: { id: "person", username: "person", name: "Person" },
    postCreatedAt: "2026-07-29T00:00:00.000Z",
  };
}

describe("runScrape", () => {
  it("collects virtualized pages, emits only new batches, and stops after idle passes", async () => {
    const pages: BookmarkSnapshot[][] = [
      [bookmark("1"), bookmark("2")],
      [bookmark("2"), bookmark("3")],
      [bookmark("3")],
      [bookmark("3")],
    ];
    let index = 0;
    const batches: string[][] = [];
    const progress: number[] = [];

    const result = await runScrape({
      scan: () => pages[Math.min(index, pages.length - 1)] ?? [],
      scroll: () => {
        index += 1;
      },
      waitForContent: async () => undefined,
      onBatch: async (items) => {
        batches.push(items.map(({ id }) => id));
      },
      onProgress: ({ fetched }) => {
        progress.push(fetched);
      },
      idlePassLimit: 2,
    });

    expect(result).toEqual({ status: "completed", fetched: 3 });
    expect(batches).toEqual([["1", "2"], ["3"]]);
    expect(progress.at(-1)).toBe(3);
  });

  it("stops promptly when cancelled", async () => {
    const controller = new AbortController();
    const scroll = vi.fn(() => controller.abort());

    const result = await runScrape({
      scan: () => [bookmark("1")],
      scroll,
      waitForContent: async () => undefined,
      onBatch: async () => undefined,
      onProgress: () => undefined,
      signal: controller.signal,
    });

    expect(result).toEqual({ status: "cancelled", fetched: 1 });
    expect(scroll).toHaveBeenCalledOnce();
  });

  it("waits while the page is loading instead of declaring the capture complete", async () => {
    const loadingStates = [true, true, false, false];
    let pass = 0;
    const scroll = vi.fn();
    const waitForContent = vi.fn(async () => {
      pass += 1;
    });

    const result = await runScrape({
      scan: () => [bookmark("1")],
      isLoading: () => loadingStates[pass] ?? false,
      isAtEnd: () => true,
      scroll,
      waitForContent,
      onBatch: async () => undefined,
      onProgress: () => undefined,
      idlePassLimit: 2,
    });

    expect(result).toEqual({ status: "completed", fetched: 1 });
    expect(waitForContent).toHaveBeenCalledTimes(4);
    expect(scroll).not.toHaveBeenCalled();
  });

  it("observes every quiet end pass so a loader that reappears cannot be mistaken for completion", async () => {
    let waitingPass = 0;
    let loading = false;
    let secondPostAvailable = false;

    const result = await runScrape({
      scan: () =>
        secondPostAvailable ? [bookmark("1"), bookmark("2")] : [bookmark("1")],
      isLoading: () => loading,
      isAtEnd: () => true,
      scroll: vi.fn(),
      waitForContent: async () => {
        waitingPass += 1;
        if (waitingPass === 3) loading = true;
        if (waitingPass === 4) {
          loading = false;
          secondPostAvailable = true;
        }
      },
      onBatch: async () => undefined,
      onProgress: () => undefined,
      idlePassLimit: 2,
    });

    expect(result).toEqual({ status: "completed", fetched: 2 });
    expect(waitingPass).toBeGreaterThanOrEqual(6);
  });

  it("resets end confirmation when a loader appears and disappears inside one wait window", async () => {
    let waitingPass = 0;
    let secondPostAvailable = false;

    const result = await runScrape({
      scan: () =>
        secondPostAvailable ? [bookmark("1"), bookmark("2")] : [bookmark("1")],
      isLoading: () => false,
      isAtEnd: () => true,
      scroll: vi.fn(),
      waitForContent: async () => {
        waitingPass += 1;
        if (waitingPass === 2) {
          return { reason: "activity" as const, loadingObserved: true };
        }
        if (waitingPass === 4) {
          secondPostAvailable = true;
          return { reason: "activity" as const, loadingObserved: false };
        }
        return { reason: "timeout" as const, loadingObserved: false };
      },
      onBatch: async () => undefined,
      onProgress: () => undefined,
      idlePassLimit: 2,
    });

    expect(result).toEqual({ status: "completed", fetched: 2 });
  });

  it("keeps scrolling when there are no new items but the page has not reached its end", async () => {
    const endStates = [false, false, true, true];
    let pass = 0;
    const scroll = vi.fn();

    const result = await runScrape({
      scan: () => [bookmark("1")],
      isLoading: () => false,
      isAtEnd: () => endStates[pass] ?? true,
      scroll,
      waitForContent: async () => {
        pass += 1;
      },
      onBatch: async () => undefined,
      onProgress: () => undefined,
      idlePassLimit: 2,
    });

    expect(result).toEqual({ status: "completed", fetched: 1 });
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it("starts observing content before scrolling so fast DOM updates are not missed", async () => {
    const controller = new AbortController();
    const events: string[] = [];

    await runScrape({
      scan: () => [bookmark("1")],
      scroll: () => {
        events.push("scroll");
        controller.abort();
      },
      waitForContent: async () => {
        events.push("watch");
      },
      onBatch: async () => undefined,
      onProgress: () => undefined,
      signal: controller.signal,
    });

    expect(events).toEqual(["watch", "scroll"]);
  });

  it("reports an incomplete review when the SPA navigates away", async () => {
    const controller = new AbortController();
    let onBookmarksPage = true;
    let waits = 0;
    const result = await runScrape({
      scan: () => [bookmark("1")],
      isPageValid: () => onBookmarksPage,
      isAtEnd: () => true,
      scroll: vi.fn(),
      waitForContent: async () => {
        waits += 1;
        onBookmarksPage = false;
        if (waits > 1) controller.abort();
        return { reason: "activity", loadingObserved: false };
      },
      onBatch: async () => undefined,
      onProgress: () => undefined,
      signal: controller.signal,
    });

    expect(result).toEqual({
      status: "incomplete",
      fetched: 1,
      errorCode: "capture_navigation_changed",
    });
  });

  it("fails safely after bounded loader retries instead of declaring an infinite loader complete", async () => {
    const controller = new AbortController();
    let waits = 0;
    const result = await runScrape({
      scan: () => [bookmark("1")],
      isLoading: () => true,
      isAtEnd: () => true,
      scroll: vi.fn(),
      waitForContent: async () => {
        waits += 1;
        if (waits === 4) controller.abort();
        return { reason: "timeout", loadingObserved: true };
      },
      onBatch: async () => undefined,
      onProgress: () => undefined,
      signal: controller.signal,
      maximumLoadingPasses: 3,
    });

    expect(result).toEqual({
      status: "incomplete",
      fetched: 1,
      errorCode: "capture_loading_timeout",
    });
    expect(waits).toBe(3);
  });

  it("bounds an intermittent loader until a new batch makes real progress", async () => {
    const controller = new AbortController();
    let waits = 0;
    const result = await runScrape({
      scan: () => [bookmark("1")],
      isLoading: () => false,
      isAtEnd: () => false,
      scroll: vi.fn(),
      waitForContent: async () => {
        waits += 1;
        if (waits === 7) controller.abort();
        return {
          reason: "activity",
          loadingObserved: waits % 2 === 1,
        };
      },
      onBatch: async () => undefined,
      onProgress: () => undefined,
      signal: controller.signal,
      maximumLoadingPasses: 3,
    });

    expect(result).toEqual({
      status: "incomplete",
      fetched: 1,
      errorCode: "capture_loading_timeout",
    });
    expect(waits).toBe(5);
  });

  it("deduplicates and streams more than one thousand posts in bounded batches", async () => {
    const source = Array.from({ length: 1_205 }, (_, index) =>
      bookmark(String(index + 1)),
    );
    const batchSizes: number[] = [];
    const received = new Set<string>();

    const result = await runScrape({
      scan: () => [...source, ...source.slice(0, 25)],
      isAtEnd: () => true,
      scroll: vi.fn(),
      waitForContent: async () => ({
        reason: "timeout",
        loadingObserved: false,
      }),
      onBatch: async (items) => {
        batchSizes.push(items.length);
        for (const item of items) received.add(item.id);
      },
      onProgress: () => undefined,
      idlePassLimit: 1,
      batchSize: 100,
    });

    expect(result).toEqual({ status: "completed", fetched: 1_205 });
    expect(batchSizes).toEqual([
      100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 5,
    ]);
    expect(received.size).toBe(1_205);
  });

  it("keeps advancing across a long empty virtualization gap before the real end", async () => {
    let waits = 0;
    let laterPostAvailable = false;
    const scroll = vi.fn();

    const result = await runScrape({
      scan: () =>
        laterPostAvailable ? [bookmark("1"), bookmark("2")] : [bookmark("1")],
      isLoading: () => false,
      isAtEnd: () => waits >= 12,
      scroll,
      waitForContent: async () => {
        waits += 1;
        if (waits === 12) laterPostAvailable = true;
        return {
          reason: waits === 12 ? "activity" : "timeout",
          loadingObserved: false,
        };
      },
      onBatch: async () => undefined,
      onProgress: () => undefined,
      idlePassLimit: 2,
    });

    expect(result).toEqual({ status: "completed", fetched: 2 });
    expect(scroll.mock.calls.length).toBeGreaterThanOrEqual(12);
  });

  it("reports only persisted batches when cancellation interrupts a large scan", async () => {
    const controller = new AbortController();
    const batchSizes: number[] = [];
    const result = await runScrape({
      scan: () => Array.from({ length: 250 }, (_, index) => bookmark(String(index))),
      scroll: vi.fn(),
      waitForContent: async () => ({
        reason: "aborted",
        loadingObserved: false,
      }),
      onBatch: async (items) => {
        batchSizes.push(items.length);
        controller.abort();
      },
      onProgress: () => undefined,
      signal: controller.signal,
      batchSize: 100,
    });

    expect(result).toEqual({ status: "cancelled", fetched: 100 });
    expect(batchSizes).toEqual([100]);
  });
});
