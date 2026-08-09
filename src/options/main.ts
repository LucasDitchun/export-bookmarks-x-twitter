import "./styles.css";

import {
  applyTranslations,
  getLocaleTag,
  loadLocaleTranslator,
  LOCALE_STORAGE_KEY,
  resolvePreferredLocale,
} from "../popup/i18n";
import type { SendMessage } from "../shared/protocol";
import { getGithubStarCount } from "../github/github-project";
import { createOptionsApp } from "./app";

async function startOptions(): Promise<void> {
  const stored = await chrome.storage.local.get(LOCALE_STORAGE_KEY);
  const locale = resolvePreferredLocale(
    stored[LOCALE_STORAGE_KEY],
    chrome.i18n.getUILanguage(),
  );
  const translate = await loadLocaleTranslator(locale);
  document.documentElement.lang = getLocaleTag(locale);
  applyTranslations(document, translate);
  const sendMessage: SendMessage = (request) => chrome.runtime.sendMessage(request);
  const app = createOptionsApp({
    document,
    sendMessage,
    translate,
    loadGithubStars: () =>
      getGithubStarCount({
        storage: {
          get: (key) => chrome.storage.local.get(key),
          set: (items) => chrome.storage.local.set(items),
        },
      }),
  });
  window.addEventListener("unload", () => app.destroy(), { once: true });
}

void startOptions();
