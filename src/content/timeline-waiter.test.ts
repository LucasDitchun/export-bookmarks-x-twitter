// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { waitForTimelineUpdate } from "./timeline-waiter";

afterEach(() => {
  vi.useRealTimers();
});

describe("waitForTimelineUpdate", () => {
  it("settles shortly after a new post is rendered instead of waiting for the fallback timeout", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <main>
        <article data-testid="tweet"><a href="/person/status/1"></a></article>
      </main>
    `;
    const completed = vi.fn();
    const waiting = waitForTimelineUpdate({
      root: document.body,
      view: window,
      settleMs: 75,
      maximumWaitMs: 1_100,
    }).then(completed);

    document
      .querySelector("main")
      ?.insertAdjacentHTML(
        "beforeend",
        '<article data-testid="tweet"><a href="/person/status/2"></a></article>',
      );
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(74);
    expect(completed).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(completed).toHaveBeenCalledOnce();
  });

  it("settles after a real scroll even when the virtualized DOM reuses the same nodes", async () => {
    vi.useFakeTimers();
    document.body.innerHTML =
      '<main><article data-testid="tweet"><a href="/person/status/1"></a></article></main>';
    const completed = vi.fn();
    const waiting = waitForTimelineUpdate({
      root: document.body,
      view: window,
      settleMs: 75,
      scrollSettleMs: 75,
      maximumWaitMs: 1_100,
    }).then(completed);

    window.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(75);
    await waiting;

    expect(completed).toHaveBeenCalledOnce();
  });

  it("cancels the pending observer immediately", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const completed = vi.fn();
    const waiting = waitForTimelineUpdate({
      root: document.body,
      view: window,
      signal: controller.signal,
    }).then(completed);

    controller.abort();
    await waiting;

    expect(completed).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores unrelated page mutations and uses the cautious fallback timeout", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <main>
        <article data-testid="tweet"><a href="/person/status/1"></a></article>
      </main>
      <aside id="unrelated"></aside>
    `;
    const completed = vi.fn();
    const waiting = waitForTimelineUpdate({
      root: document.body,
      view: window,
      settleMs: 25,
      maximumWaitMs: 200,
    }).then((result) => {
      completed(result);
      return result;
    });

    document.getElementById("unrelated")?.append(document.createElement("span"));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(199);
    expect(completed).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(waiting).resolves.toEqual({
      reason: "timeout",
      loadingObserved: false,
    });
    expect(completed).toHaveBeenCalledOnce();
  });

  it("remembers a loader that appears during the wait even after it is removed", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<main id="timeline"></main>';
    const root = document.getElementById("timeline") as HTMLElement;
    const waiting = waitForTimelineUpdate({
      root,
      view: window,
      settleMs: 25,
      maximumWaitMs: 200,
    });

    const loader = document.createElement("div");
    loader.setAttribute("role", "progressbar");
    root.append(loader);
    loader.remove();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(200);

    await expect(waiting).resolves.toEqual({
      reason: "activity",
      loadingObserved: true,
    });
  });
});
