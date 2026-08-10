// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import type { LiveBookmarkContext } from "../shared/protocol";
import { renderLiveBookmarkStatus } from "./live-bookmark-status";

const context: LiveBookmarkContext = {
  intentId: "intent-1",
  action: "save",
  state: "pending",
  bookmark: {
    id: "123",
    text: "<img src=x onerror=alert(1)>",
    url: "https://x.com/alice/status/123",
    author: { id: "alice", username: "alice", name: "Alice" },
    postCreatedAt: "2026-08-09T09:00:00.000Z",
  },
  updatedAt: "2026-08-09T09:00:00.000Z",
};

describe("renderLiveBookmarkStatus", () => {
  it("renders a fresh pending action as plain, accessible text", () => {
    const element = document.createElement("section");
    renderLiveBookmarkStatus(element, context, (key) => key, {
      now: () => new Date("2026-08-09T09:00:05.000Z"),
    });

    expect(element.hidden).toBe(false);
    expect(element.dataset.state).toBe("pending");
    expect(element.textContent).toContain("liveBookmarkPending");
    expect(element.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(element.querySelector("img")).toBeNull();
  });

  it("maps final states and hides stale or missing actions", () => {
    const element = document.createElement("section");
    renderLiveBookmarkStatus(element, { ...context, state: "saved" }, (key) => key, {
      now: () => new Date("2026-08-09T09:00:05.000Z"),
    });
    expect(element.textContent).toContain("liveBookmarkSaved");

    renderLiveBookmarkStatus(element, context, (key) => key, {
      now: () => new Date("2026-08-09T09:01:00.000Z"),
    });
    expect(element.hidden).toBe(true);
    renderLiveBookmarkStatus(element, null, (key) => key);
    expect(element.hidden).toBe(true);
  });
});
