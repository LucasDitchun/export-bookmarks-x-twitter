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

async function getStoredLocale(): Promise<unknown> {
  try {
    const stored = await chrome.storage.local.get(LOCALE_STORAGE_KEY);
    return stored[LOCALE_STORAGE_KEY];
  } catch {
    return undefined;
  }
}

async function startPopup(): Promise<void> {
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
  const app = createPopupApp({
    document,
    locale,
    sendMessage,
    translate,
  });
  window.addEventListener("unload", app.destroy, { once: true });
}

void startPopup();
