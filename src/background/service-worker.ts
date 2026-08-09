import { ArchiveRepository } from "../storage/archive-repository";
import { BookmarkRepository } from "../storage/bookmark-repository";
import { ExtensionStateRepository } from "../storage/extension-state";
import { TagRepository } from "../storage/tag-repository";
import { FolderRepository } from "../storage/folder-repository";
import { SettingsRepository } from "../settings/settings-repository";
import { BackupRepository } from "../storage/backup-repository";
import { SearchRepository } from "../storage/search-repository";
import { BackgroundController } from "./controller";

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
const settings = new SettingsRepository({
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
const controller = new BackgroundController({
  archive,
  bookmarks,
  tags,
  folders,
  search,
  settings,
  backup,
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  messageQueue = messageQueue
    .then(async () => {
      sendResponse(await controller.handle(request, sender));
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
