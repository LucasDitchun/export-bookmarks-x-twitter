import type {
  BookmarkLocalizationResult,
  ContentControlRequest,
} from "../shared/protocol";

export function isLocaleStorageChange(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
  localeStorageKey: string,
): boolean {
  return areaName === "local" && Object.hasOwn(changes, localeStorageKey);
}

interface LocaleRefreshTab {
  id?: number | undefined;
}

interface LocaleRefreshDependencies {
  invalidateLocalization(): void;
  loadLocalization(): Promise<BookmarkLocalizationResult>;
  queryTabs(): Promise<LocaleRefreshTab[]>;
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
          try {
            dependencies.invalidateLocalization();
            const localization = await dependencies.loadLocalization();
            const tabs = await dependencies.queryTabs();
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
          } catch (error) {
            if (!queued) throw error;
          }
        }
      })
      .finally(() => {
        running = null;
      });
    return running;
  };
}
