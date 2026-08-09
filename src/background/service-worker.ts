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
import type { ContentControlRequest } from "../shared/protocol";
import { metadataRefreshRequest } from "./metadata-refresh";

const state = new ExtensionStateRepository({
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
  remove: (keys) => chrome.storage.local.remove(keys),
});
const archive = new ArchiveRepository();
const bookmarks = new BookmarkRepository();
const tags = new TagRepository();
const folders = new FolderRepository();
const search = new SearchRepository();
const exports = new ExportRepository();
const settings = new SettingsRepository({
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
});
const liveState = new LiveBookmarkStateRepository({
  get: (keys) => chrome.storage.local.get(keys),
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
const metadataMessageKeys = [
  "bookmarkMetadataLabel",
  "bookmarkMetadataMapped",
  "bookmarkMetadataArchived",
  "liveBookmarkPending",
  "bookmarkNeedsCategory",
  "bookmarkPromptFolder",
  "bookmarkPromptTags",
  "bookmarkPromptNote",
  "uncategorizedFolder",
] as const;
const localeMessageCache = new Map<string, Promise<Record<string, string>>>();

function loadMetadataMessages(localeName: string): Promise<Record<string, string>> {
  const cached = localeMessageCache.get(localeName);
  if (cached) return cached;
  const loading = fetch(
    chrome.runtime.getURL(`_locales/${localeName}/messages.json`),
  ).then(async (response) => {
    if (!response.ok) throw new Error("Could not load metadata translations.");
    const catalog = (await response.json()) as Record<string, { message?: unknown }>;
    return Object.fromEntries(
      metadataMessageKeys.flatMap((key) =>
        typeof catalog[key]?.message === "string" ? [[key, catalog[key].message]] : [],
      ),
    );
  });
  localeMessageCache.set(localeName, loading);
  return loading;
}

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
  search,
  settings,
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
  },
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

void chrome.storage.local.setAccessLevel({
  accessLevel: "TRUSTED_CONTEXTS",
});

let messageQueue: Promise<void> = Promise.resolve();

async function broadcastMetadataRefresh(request: ContentControlRequest): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs.flatMap((tab) =>
      typeof tab.id === "number" ? [chrome.tabs.sendMessage(tab.id, request)] : [],
    ),
  );
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  messageQueue = messageQueue
    .then(async () => {
      const response = await controller.handle(request, sender);
      sendResponse(response);
      const refresh = response.ok ? metadataRefreshRequest(request) : null;
      if (refresh) void broadcastMetadataRefresh(refresh).catch(() => undefined);
    })
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
