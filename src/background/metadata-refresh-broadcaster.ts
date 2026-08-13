import type { ContentControlRequest } from "../shared/protocol";

type MetadataRefreshRequest = Extract<
  ContentControlRequest,
  { type: "REFRESH_BOOKMARK_METADATA" }
>;

interface MetadataRefreshTab {
  id?: number | undefined;
}

interface MetadataRefreshBroadcasterDependencies {
  queryTabs(): Promise<MetadataRefreshTab[]>;
  sendToTab(tabId: number, request: MetadataRefreshRequest): Promise<unknown>;
  waitBeforeQueryRetry?(attempt: number): Promise<void>;
}

type PendingRefresh = Set<string> | "full";
const MAX_QUERY_ATTEMPTS = 2;

function defaultRetryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 25 * attempt);
  });
}

function mergeRefresh(
  current: PendingRefresh | null,
  request: MetadataRefreshRequest,
): PendingRefresh {
  if (!request.bookmarkIds || current === "full") return "full";
  return new Set([...(current ?? []), ...request.bookmarkIds]);
}

function mergePending(
  current: PendingRefresh,
  queued: PendingRefresh | null,
): PendingRefresh {
  if (current === "full" || queued === "full") return "full";
  return new Set([...current, ...(queued ?? [])]);
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

export function createMetadataRefreshBroadcaster(
  dependencies: MetadataRefreshBroadcasterDependencies,
): (request: MetadataRefreshRequest) => Promise<void> {
  let pending: PendingRefresh | null = null;
  let running: Promise<void> | null = null;

  const drain = async (): Promise<void> => {
    let queryAttempts = 0;
    while (pending) {
      await Promise.resolve();
      const current = pending;
      pending = null;
      const requests = toRequests(current);
      let tabs: MetadataRefreshTab[];
      try {
        tabs = await dependencies.queryTabs();
      } catch (error) {
        pending = mergePending(current, pending);
        queryAttempts += 1;
        if (queryAttempts >= MAX_QUERY_ATTEMPTS) throw error;
        await (dependencies.waitBeforeQueryRetry ?? defaultRetryDelay)(queryAttempts);
        continue;
      }
      queryAttempts = 0;
      await Promise.allSettled(
        tabs.flatMap((tab) => {
          if (typeof tab.id !== "number") return [];
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
