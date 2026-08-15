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
import type { FirstUseDisclosureResult, SettingsResult } from "../shared/protocol";
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
import { createAppNavigation } from "./navigation";
import { SemanticStateRepository } from "../semantic/semantic-state-repository";
import { SemanticSearchClient } from "../semantic/semantic-search-client";
import type { SemanticCorpusResult } from "../shared/protocol";
import {
  DATE_TIME_PREFERENCES_KEY,
  loadDateTimePreferences,
  sanitizeDateTimePreferences,
} from "../settings/date-time-preferences";
import { createFirstUseDisclosureUi } from "./first-use-disclosure-ui";

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
  const dateTimePreferences = await loadDateTimePreferences({
    get: (key) => chrome.storage.local.get(key),
  });
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
  const disclosureUi = createFirstUseDisclosureUi({
    document,
    async loadAccepted() {
      const response = await sendMessage<FirstUseDisclosureResult>({
        type: "GET_FIRST_USE_DISCLOSURE",
      });
      return response.ok && response.data.accepted;
    },
    async accept() {
      const response = await sendMessage<FirstUseDisclosureResult>({
        type: "ACCEPT_FIRST_USE_DISCLOSURE",
      });
      if (!response.ok) throw new Error(response.error.code);
    },
    onAccepted() {},
    failureMessage: translate("firstUseDisclosureFailure"),
  });
  await disclosureUi.initialize();
  const semanticSearch = new SemanticSearchClient(
    new SemanticStateRepository({
      get: (key) => chrome.storage.local.get(key),
      set: (items) => chrome.storage.local.set(items),
    }),
    async () => {
      const response = await sendMessage<SemanticCorpusResult>({
        type: "GET_SEMANTIC_CORPUS",
      });
      if (!response.ok) throw new Error(response.error.code);
      return response.data.documents;
    },
    () =>
      new Worker(new URL("../semantic/semantic-worker.ts", import.meta.url), {
        type: "module",
      }),
  );
  applyLibraryUiSettings(document, DEFAULT_SETTINGS);
  let filterAsYouType = DEFAULT_SETTINGS.search.filterAsYouType;
  let categorizationFields = DEFAULT_SETTINGS.behavior.metadata;
  let quickStopThreshold = DEFAULT_SETTINGS.data.quickStopThreshold;
  let app: ReturnType<typeof createPopupApp> | null = null;
  const settingsUi = createSettingsUiController({
    document,
    async load() {
      const response = await sendMessage<SettingsResult>({ type: "GET_SETTINGS" });
      return response.ok ? response.data.settings : null;
    },
    onApply(settings) {
      filterAsYouType = settings.search.filterAsYouType;
      categorizationFields = settings.behavior.metadata;
      quickStopThreshold = settings.data.quickStopThreshold;
      app?.setFilterAsYouType(filterAsYouType);
      app?.setCategorizationFields(categorizationFields);
      app?.setQuickStopThreshold(quickStopThreshold);
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
    if (areaName === "local" && Object.hasOwn(changes, DATE_TIME_PREFERENCES_KEY)) {
      app?.setDateTimePreferences(
        sanitizeDateTimePreferences(changes[DATE_TIME_PREFERENCES_KEY]?.newValue),
      );
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
  const navigation = createAppNavigation({ document });
  app = createPopupApp({
    document,
    locale,
    sendMessage,
    translate,
    filterAsYouType,
    categorizationFields,
    dateTimePreferences,
    quickStopThreshold,
    onBookmarkOpened: navigation.openDetail,
    semanticSearch: (query, view, limit) => semanticSearch.search(query, view, limit),
  });
  window.addEventListener(
    "unload",
    () => {
      chrome.storage.onChanged.removeListener(refreshSettings);
      settingsUi.destroy();
      semanticSearch.destroy();
      navigation.destroy();
      disclosureUi.destroy();
      app?.destroy();
    },
    { once: true },
  );
}

void startPopup();
