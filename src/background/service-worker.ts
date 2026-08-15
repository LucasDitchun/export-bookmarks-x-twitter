import { ArchiveRepository } from "../storage/archive-repository";
import { BookmarkRepository } from "../storage/bookmark-repository";
import { ExtensionStateRepository } from "../storage/extension-state";
import { TagRepository } from "../storage/tag-repository";
import { FolderRepository } from "../storage/folder-repository";
import { SettingsRepository } from "../settings/settings-repository";
import { BackupRepository } from "../storage/backup-repository";
import { SearchRepository } from "../storage/search-repository";
import { LiveBookmarkStateRepository } from "../storage/live-bookmark-state";
import { LOCALE_STORAGE_KEY, resolvePreferredLocale } from "../popup/i18n";
import { ExportRepository } from "../storage/export-repository";
import { BackgroundController } from "./controller";
import { metadataRefreshAfterResponse } from "./metadata-refresh";
import { SemanticIndexRepository } from "../semantic/semantic-index-repository";
import { SemanticStateRepository } from "../semantic/semantic-state-repository";
import { createLocaleCatalogCache } from "./locale-catalog-cache";
import { bookmarkMetadataMessagesFromCatalog } from "../shared/bookmark-metadata-messages";
import { BookmarkMetadataRepository } from "../storage/bookmark-metadata-repository";
import { FirstUseDisclosureRepository } from "../privacy/first-use-disclosure";
import {
  isGlobalSerializationBarrierAwareRead,
  isGlobalSerializationBarrier,
  KeyedTaskQueue,
  messageSerializationKey,
} from "./message-serialization";
import { createMetadataRefreshBroadcaster } from "./metadata-refresh-broadcaster";
import {
  createLocaleRefreshBroadcaster,
  isLocaleStorageChange,
} from "./locale-refresh";

const state = new ExtensionStateRepository({
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
  remove: (keys) => chrome.storage.local.remove(keys),
});
const archive = new ArchiveRepository();
const bookmarks = new BookmarkRepository();
const tags = new TagRepository();
const folders = new FolderRepository();
const metadata = new BookmarkMetadataRepository();
const search = new SearchRepository();
const semanticIndex = new SemanticIndexRepository();
const semanticState = new SemanticStateRepository({
  get: (key) => chrome.storage.local.get(key),
  set: (items) => chrome.storage.local.set(items),
});
const semantic = {
  async clearArchiveData(): Promise<void> {
    await semanticIndex.clear();
    await semanticState.reset();
  },
};
const exports = new ExportRepository();
const settings = new SettingsRepository({
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
});
const liveState = new LiveBookmarkStateRepository({
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
});
const disclosure = new FirstUseDisclosureRepository({
  get: (key) => chrome.storage.local.get(key),
  set: (items) => chrome.storage.local.set(items),
});

async function configureSurface(surface: "modal" | "sidePanel"): Promise<void> {
  const sidePanel = surface === "sidePanel";
  await Promise.all([
    chrome.action.setPopup({ popup: sidePanel ? "" : "popup.html" }),
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: sidePanel }),
  ]);
}
const backup = new BackupRepository("bookmark-x", {
  storage: {
    get: (keys) => chrome.storage.local.get(keys),
    set: (items) => chrome.storage.local.set(items),
  },
  settings,
});
const loadMetadataMessages = createLocaleCatalogCache(async (localeName) => {
  const response = await fetch(
    chrome.runtime.getURL(`_locales/${localeName}/messages.json`),
  );
  if (!response.ok) throw new Error("Could not load metadata translations.");
  return bookmarkMetadataMessagesFromCatalog(await response.json());
});

const locale = {
  async get() {
    const stored = await chrome.storage.local.get(LOCALE_STORAGE_KEY);
    const selectedLocale = resolvePreferredLocale(
      stored[LOCALE_STORAGE_KEY],
      chrome.i18n.getUILanguage(),
    );
    const english = await loadMetadataMessages("en");
    const selected =
      selectedLocale === "en"
        ? english
        : await loadMetadataMessages(selectedLocale).catch(() => english);
    return { locale: selectedLocale, messages: { ...english, ...selected } };
  },
};
const controller = new BackgroundController({
  archive,
  exports,
  bookmarks,
  tags,
  folders,
  metadata,
  search,
  semantic,
  settings,
  disclosure,
  locale,
  backup,
  liveState,
  state,
  extensionId: chrome.runtime.id,
  browser: {
    async getActiveTab() {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return typeof tab?.id === "number" ? { id: tab.id, url: tab.url } : null;
    },
    async openBookmarks() {
      await chrome.tabs.create({ url: "https://x.com/i/bookmarks" });
    },
    sendToTab: (tabId, request) => chrome.tabs.sendMessage(tabId, request),
    configureSurface,
    openSidePanel: (tabId) => chrome.sidePanel.open({ tabId }),
    async enablePostProcessing() {
      const tabs = await chrome.tabs.query({});
      await Promise.allSettled(
        tabs.flatMap((tab) =>
          typeof tab.id === "number"
            ? [
                chrome.tabs.sendMessage(tab.id, {
                  type: "ENABLE_POST_PROCESSING",
                }),
              ]
            : [],
        ),
      );
    },
  },
});
const broadcastLocaleRefresh = createLocaleRefreshBroadcaster({
  invalidateLocalization: () => controller.invalidateDecorationLocalization(),
  loadLocalization: () => locale.get(),
  queryTabs: () => chrome.tabs.query({}),
  sendToTab: (tabId, request) => chrome.tabs.sendMessage(tabId, request),
});

async function restoreSurfacePreference(): Promise<void> {
  const current = await settings.get();
  await configureSurface(current.behavior.surface);
}

function scheduleSurfaceRestore(): void {
  void restoreSurfacePreference().catch((error: unknown) => {
    console.error("Bookmark X could not restore its selected surface.", error);
  });
}

scheduleSurfaceRestore();
chrome.runtime.onInstalled.addListener(scheduleSurfaceRestore);
chrome.runtime.onStartup.addListener(scheduleSurfaceRestore);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (isLocaleStorageChange(changes, areaName, LOCALE_STORAGE_KEY)) {
    void broadcastLocaleRefresh().catch(() => undefined);
  }
});

void chrome.storage.local.setAccessLevel({
  accessLevel: "TRUSTED_CONTEXTS",
});

const messageQueue = new KeyedTaskQueue();
const broadcastMetadataRefresh = createMetadataRefreshBroadcaster({
  queryTabs: () => chrome.tabs.query({}),
  sendToTab: (tabId, request) => chrome.tabs.sendMessage(tabId, request),
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  void messageQueue
    .run(
      messageSerializationKey(request),
      async () => {
        const response = await controller.handle(request, sender);
        sendResponse(response);
        const refresh = metadataRefreshAfterResponse(request, response);
        if (refresh) void broadcastMetadataRefresh(refresh).catch(() => undefined);
      },
      {
        globalBarrier: isGlobalSerializationBarrier(request),
        waitForGlobalBarrier: isGlobalSerializationBarrierAwareRead(request),
      },
    )
    .catch(() => {
      sendResponse({
        ok: false,
        error: {
          code: "internal_error",
          message: "Bookmark X could not complete the request.",
        },
      });
    });
  return true;
});
