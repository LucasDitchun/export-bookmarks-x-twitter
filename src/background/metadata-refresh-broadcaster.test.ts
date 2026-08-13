import { describe, expect, it, vi } from "vitest";

import { createMetadataRefreshBroadcaster } from "./metadata-refresh-broadcaster";

describe("createMetadataRefreshBroadcaster", () => {
  it("targets only X tabs and ignores defensive non-X query results", async () => {
    const queryTabs = vi.fn(async () => [
      { id: 1, url: "https://x.com/home" },
      { id: 2, url: "https://www.x.com/user/status/123" },
      { id: 3, url: "https://example.com" },
      { id: undefined, url: "https://x.com/explore" },
    ]);
    const sendToTab = vi.fn(async () => undefined);
    const broadcast = createMetadataRefreshBroadcaster({ queryTabs, sendToTab });

    await broadcast({ type: "REFRESH_BOOKMARK_METADATA", bookmarkIds: ["123"] });

    expect(queryTabs).toHaveBeenCalledWith({
      url: ["https://x.com/*", "https://www.x.com/*"],
    });
    expect(sendToTab).toHaveBeenCalledTimes(2);
    expect(sendToTab).toHaveBeenCalledWith(1, {
      type: "REFRESH_BOOKMARK_METADATA",
      bookmarkIds: ["123"],
    });
    expect(sendToTab).toHaveBeenCalledWith(2, {
      type: "REFRESH_BOOKMARK_METADATA",
      bookmarkIds: ["123"],
    });
  });

  it("coalesces concurrent bursts per tab and deduplicates bookmark IDs", async () => {
    const queryTabs = vi.fn(async () => [{ id: 1, url: "https://x.com/home" }]);
    const sendToTab = vi.fn(async () => undefined);
    const broadcast = createMetadataRefreshBroadcaster({ queryTabs, sendToTab });

    await Promise.all([
      broadcast({ type: "REFRESH_BOOKMARK_METADATA", bookmarkIds: ["123", "456"] }),
      broadcast({ type: "REFRESH_BOOKMARK_METADATA", bookmarkIds: ["456", "789"] }),
      broadcast({ type: "REFRESH_BOOKMARK_METADATA", bookmarkIds: ["123"] }),
    ]);

    expect(queryTabs).toHaveBeenCalledOnce();
    expect(sendToTab).toHaveBeenCalledOnce();
    expect(sendToTab).toHaveBeenCalledWith(1, {
      type: "REFRESH_BOOKMARK_METADATA",
      bookmarkIds: ["123", "456", "789"],
    });
  });

  it("lets a full refresh dominate queued bookmark IDs", async () => {
    let releaseFirstSend!: () => void;
    const firstSend = new Promise<void>((resolve) => {
      releaseFirstSend = resolve;
    });
    const queryTabs = vi.fn(async () => [{ id: 1, url: "https://x.com/home" }]);
    const sendToTab = vi
      .fn<(tabId: number, request: unknown) => Promise<void>>()
      .mockReturnValueOnce(firstSend)
      .mockResolvedValue(undefined);
    const broadcast = createMetadataRefreshBroadcaster({ queryTabs, sendToTab });

    const initial = broadcast({
      type: "REFRESH_BOOKMARK_METADATA",
      bookmarkIds: ["123"],
    });
    await vi.waitFor(() => expect(sendToTab).toHaveBeenCalledOnce());
    const targeted = broadcast({
      type: "REFRESH_BOOKMARK_METADATA",
      bookmarkIds: ["456"],
    });
    const full = broadcast({ type: "REFRESH_BOOKMARK_METADATA" });
    releaseFirstSend();
    await Promise.all([initial, targeted, full]);

    expect(sendToTab).toHaveBeenCalledTimes(2);
    expect(sendToTab.mock.calls[1]).toEqual([
      1,
      { type: "REFRESH_BOOKMARK_METADATA" },
    ]);
  });

  it("isolates tab errors and cleans up after a completed burst", async () => {
    const queryTabs = vi.fn(async () => [
      { id: 1, url: "https://x.com/home" },
      { id: 2, url: "https://x.com/explore" },
    ]);
    const sendToTab = vi.fn(async (tabId: number) => {
      if (tabId === 1) throw new Error("Tab closed");
    });
    const broadcast = createMetadataRefreshBroadcaster({ queryTabs, sendToTab });

    await expect(
      broadcast({ type: "REFRESH_BOOKMARK_METADATA", bookmarkIds: ["123"] }),
    ).resolves.toBeUndefined();
    expect(sendToTab).toHaveBeenCalledWith(2, {
      type: "REFRESH_BOOKMARK_METADATA",
      bookmarkIds: ["123"],
    });

    await broadcast({ type: "REFRESH_BOOKMARK_METADATA", bookmarkIds: ["456"] });
    expect(queryTabs).toHaveBeenCalledTimes(2);
    expect(sendToTab).toHaveBeenCalledTimes(4);
  });

  it("keeps coalesced targeted refreshes within the content message limit", async () => {
    const queryTabs = vi.fn(async () => [{ id: 1, url: "https://x.com/home" }]);
    const sendToTab = vi.fn(
      async (tabId: number, request: { bookmarkIds?: string[] }) => {
        void tabId;
        void request;
      },
    );
    const broadcast = createMetadataRefreshBroadcaster({ queryTabs, sendToTab });
    const first = Array.from({ length: 100 }, (_, index) => String(1_000 + index));
    const second = Array.from({ length: 75 }, (_, index) => String(1_075 + index));

    await Promise.all([
      broadcast({ type: "REFRESH_BOOKMARK_METADATA", bookmarkIds: first }),
      broadcast({ type: "REFRESH_BOOKMARK_METADATA", bookmarkIds: second }),
    ]);

    expect(sendToTab).toHaveBeenCalledTimes(2);
    expect(sendToTab.mock.calls[0]?.[1].bookmarkIds).toHaveLength(100);
    expect(sendToTab.mock.calls[1]?.[1].bookmarkIds).toHaveLength(50);
    expect(
      sendToTab.mock.calls.flatMap(([, request]) => request.bookmarkIds ?? []),
    ).toEqual(Array.from({ length: 150 }, (_, index) => String(1_000 + index)));
  });
});
