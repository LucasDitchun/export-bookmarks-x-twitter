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
import { createSemanticOptionsUi } from "./semantic-options-ui";
import { SemanticStateRepository } from "../semantic/semantic-state-repository";
import { SemanticSearchClient } from "../semantic/semantic-search-client";
import type { SemanticCorpusResult } from "../shared/protocol";
import {
  loadDateTimePreferences,
  saveDateTimePreferences,
} from "../settings/date-time-preferences";

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
  const semanticClient = new SemanticSearchClient(
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
    loadDateTimePreferences: () =>
      loadDateTimePreferences({
        get: (key) => chrome.storage.local.get(key),
      }),
    saveDateTimePreferences: (preferences) =>
      saveDateTimePreferences(
        { set: (items) => chrome.storage.local.set(items) },
        preferences,
      ),
  });
  const semanticUi = createSemanticOptionsUi({
    document,
    client: semanticClient,
    translate,
  });
  window.addEventListener(
    "unload",
    () => {
      semanticUi.destroy();
      semanticClient.destroy();
      app.destroy();
    },
    { once: true },
  );
}

void startOptions();
