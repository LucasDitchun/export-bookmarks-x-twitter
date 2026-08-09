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
  const settingsUi = createSettingsUiController({
    document,
    async load() {
      const response = await sendMessage<SettingsResult>({ type: "GET_SETTINGS" });
      return response.ok ? response.data.settings : null;
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
  };
  chrome.storage.onChanged.addListener(refreshSettings);
  document.getElementById("open-settings-button")?.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
  });
  const app = createPopupApp({
    document,
    locale,
    sendMessage,
    translate,
  });
  window.addEventListener(
    "unload",
    () => {
      chrome.storage.onChanged.removeListener(refreshSettings);
      settingsUi.destroy();
      app.destroy();
    },
    { once: true },
  );
}

void startPopup();
