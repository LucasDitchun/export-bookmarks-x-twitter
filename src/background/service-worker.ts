import { ArchiveRepository } from "../storage/archive-repository";
import { ExtensionStateRepository } from "../storage/extension-state";
import { BackgroundController } from "./controller";

const state = new ExtensionStateRepository({
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
  remove: (keys) => chrome.storage.local.remove(keys),
});
const archive = new ArchiveRepository();
const controller = new BackgroundController({
  archive,
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
  },
});

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
