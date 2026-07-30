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
    expect(waitForContent).toHaveBeenCalledTimes(3);
    expect(scroll).toHaveBeenCalledOnce();
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
    expect(scroll).toHaveBeenCalledTimes(3);
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
});
