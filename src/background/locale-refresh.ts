import type {
  BookmarkLocalizationResult,
  ContentControlRequest,
} from "../shared/protocol";

export const X_TAB_URL_PATTERNS = ["https://x.com/*", "https://www.x.com/*"] as const;

export function isLocaleStorageChange(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
  localeStorageKey: string,
): boolean {
  return areaName === "local" && Object.hasOwn(changes, localeStorageKey);
}

interface LocaleRefreshTab {
  id?: number | undefined;
  url?: string | undefined;
}

interface LocaleRefreshDependencies {
  loadLocalization(): Promise<BookmarkLocalizationResult>;
  queryTabs(query: { url: readonly string[] }): Promise<LocaleRefreshTab[]>;
  sendToTab(tabId: number, request: ContentControlRequest): Promise<unknown>;
}

export function createLocaleRefreshBroadcaster(
  dependencies: LocaleRefreshDependencies,
): () => Promise<void> {
  let queued = false;
  let running: Promise<void> | null = null;

  return () => {
    queued = true;
    running ??= Promise.resolve()
      .then(async () => {
        while (queued) {
          queued = false;
          const localization = await dependencies.loadLocalization();
          const tabs = await dependencies.queryTabs({ url: X_TAB_URL_PATTERNS });
          const request: ContentControlRequest = {
            type: "REFRESH_BOOKMARK_LOCALIZATION",
            localization,
          };
          await Promise.allSettled(
            tabs.flatMap((tab) =>
              typeof tab.id === "number"
                ? [dependencies.sendToTab(tab.id, request)]
                : [],
            ),
          );
        }
      })
      .finally(() => {
        running = null;
      });
    return running;
  };
}
