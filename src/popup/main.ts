import "./styles.css";

import { createPopupApp } from "./app";
import {
  applyTranslations,
  bindLanguageSelector,
  getLocaleTag,
  loadLocaleTranslator,
  LOCALE_STORAGE_KEY,
  resolvePreferredLocale,
} from "./i18n";
import type { SendMessage } from "./protocol";
import type { SettingsResult } from "../shared/protocol";
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
} from "../settings/settings-repository";
import { applyLibraryUiSettings, createSettingsUiController } from "./settings-ui";
import {
  isLiveBookmarkContext,
  LIVE_BOOKMARK_CONTEXT_KEY,
} from "../storage/live-bookmark-state";
import { renderLiveBookmarkStatus } from "./live-bookmark-status";

function applySurfaceContext(): void {
  const params = new URLSearchParams(window.location.search);
  document.documentElement.dataset.surface =
    params.get("surface") === "side-panel" ? "side-panel" : "popup";
}

async function getStoredLocale(): Promise<unknown> {
  try {
    const stored = await chrome.storage.local.get(LOCALE_STORAGE_KEY);
    return stored[LOCALE_STORAGE_KEY];
  } catch {
    return undefined;
  }
}

async function startPopup(): Promise<void> {
  applySurfaceContext();
  const locale = resolvePreferredLocale(
    await getStoredLocale(),
    chrome.i18n.getUILanguage(),
  );
  const translate = await loadLocaleTranslator(locale);
  document.documentElement.lang = getLocaleTag(locale);
  applyTranslations(document, translate);
  const liveBookmarkStatus = document.getElementById("live-bookmark-status");
  const isSidePanel = document.documentElement.dataset.surface === "side-panel";
  const renderLiveStatus = (value: unknown): void => {
    if (!liveBookmarkStatus) return;
    renderLiveBookmarkStatus(
      liveBookmarkStatus,
      isSidePanel && isLiveBookmarkContext(value) ? value : null,
      translate,
    );
  };
  if (isSidePanel) {
    try {
      const stored = await chrome.storage.local.get(LIVE_BOOKMARK_CONTEXT_KEY);
      renderLiveStatus(stored[LIVE_BOOKMARK_CONTEXT_KEY]);
    } catch {
      renderLiveStatus(null);
    }
  }

  const languageSelect = document.getElementById(
    "language-select",
  ) as HTMLSelectElement | null;
  if (languageSelect) {
    bindLanguageSelector(
      languageSelect,
      locale,
      (selectedLocale) =>
        chrome.storage.local.set({ [LOCALE_STORAGE_KEY]: selectedLocale }),
      () => window.location.reload(),
    );
  }

  const sendMessage: SendMessage = (request) => chrome.runtime.sendMessage(request);
  applyLibraryUiSettings(document, DEFAULT_SETTINGS);
  let filterAsYouType = DEFAULT_SETTINGS.search.filterAsYouType;
  let app: ReturnType<typeof createPopupApp> | null = null;
  const settingsUi = createSettingsUiController({
    document,
    async load() {
      const response = await sendMessage<SettingsResult>({ type: "GET_SETTINGS" });
      return response.ok ? response.data.settings : null;
    },
    onApply(settings) {
      filterAsYouType = settings.search.filterAsYouType;
      app?.setFilterAsYouType(filterAsYouType);
    },
  });
  await settingsUi.refresh();
  const refreshSettings = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string,
  ): void => {
    if (areaName === "local" && Object.hasOwn(changes, SETTINGS_STORAGE_KEY)) {
      void settingsUi.refresh();
    }
    if (areaName === "local" && Object.hasOwn(changes, LIVE_BOOKMARK_CONTEXT_KEY)) {
      const value = changes[LIVE_BOOKMARK_CONTEXT_KEY]?.newValue;
      renderLiveStatus(value);
      if (isSidePanel && isLiveBookmarkContext(value)) {
        void app?.handleLiveBookmarkContext(value);
      }
    }
  };
  chrome.storage.onChanged.addListener(refreshSettings);
  document.getElementById("open-settings-button")?.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
  });
  app = createPopupApp({
    document,
    locale,
    sendMessage,
    translate,
    filterAsYouType,
  });
  window.addEventListener(
    "unload",
    () => {
      chrome.storage.onChanged.removeListener(refreshSettings);
      settingsUi.destroy();
      app?.destroy();
    },
    { once: true },
  );
}

void startPopup();
