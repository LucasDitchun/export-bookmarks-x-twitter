import type { ContentControlRequest } from "../shared/protocol";
import { X_TAB_URL_PATTERNS } from "./locale-refresh";

type MetadataRefreshRequest = Extract<
  ContentControlRequest,
  { type: "REFRESH_BOOKMARK_METADATA" }
>;

interface MetadataRefreshTab {
  id?: number | undefined;
  url?: string | undefined;
}

interface MetadataRefreshBroadcasterDependencies {
  queryTabs(query: { url: readonly string[] }): Promise<MetadataRefreshTab[]>;
  sendToTab(tabId: number, request: MetadataRefreshRequest): Promise<unknown>;
}

type PendingRefresh = Set<string> | "full";

function mergeRefresh(
  current: PendingRefresh | null,
  request: MetadataRefreshRequest,
): PendingRefresh {
  if (!request.bookmarkIds || current === "full") return "full";
  return new Set([...(current ?? []), ...request.bookmarkIds]);
}

function toRequests(pending: PendingRefresh): MetadataRefreshRequest[] {
  if (pending === "full") return [{ type: "REFRESH_BOOKMARK_METADATA" }];
  const ids = [...pending];
  const requests: MetadataRefreshRequest[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    requests.push({
      type: "REFRESH_BOOKMARK_METADATA",
      bookmarkIds: ids.slice(offset, offset + 100),
    });
  }
  return requests;
}

function isXUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      (parsed.hostname === "x.com" || parsed.hostname === "www.x.com")
    );
  } catch {
    return false;
  }
}

export function createMetadataRefreshBroadcaster(
  dependencies: MetadataRefreshBroadcasterDependencies,
): (request: MetadataRefreshRequest) => Promise<void> {
  let pending: PendingRefresh | null = null;
  let running: Promise<void> | null = null;

  const drain = async (): Promise<void> => {
    while (pending) {
      await Promise.resolve();
      const current = pending;
      pending = null;
      const requests = toRequests(current);
      const tabs = await dependencies.queryTabs({ url: X_TAB_URL_PATTERNS });
      await Promise.allSettled(
        tabs.flatMap((tab) => {
          if (typeof tab.id !== "number" || !isXUrl(tab.url)) return [];
          const tabId = tab.id;
          return requests.map((request) => dependencies.sendToTab(tabId, request));
        }),
      );
    }
  };

  return (request) => {
    pending = mergeRefresh(pending, request);
    if (!running) {
      running = drain().finally(() => {
        running = null;
      });
    }
    return running;
  };
}
