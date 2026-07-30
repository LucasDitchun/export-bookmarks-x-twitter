import { isSupportedLocale, type SupportedLocale } from "../domain/types";

export type Translator = (key: string, substitutions?: string | string[]) => string;

export const LOCALE_STORAGE_KEY = "uiLocale";

const LOCALE_TAGS: Record<SupportedLocale, string> = {
  en: "en",
  pt_BR: "pt-BR",
  ja: "ja",
  es: "es",
  zh_CN: "zh-CN",
  de: "de",
  fr: "fr",
  it: "it",
};

interface LocaleMessage {
  message: string;
  placeholders?: Record<string, { content: string }>;
}

export type LocaleCatalog = Record<string, LocaleMessage>;

export function createChromeTranslator(): Translator {
  return (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;
}

export function resolvePreferredLocale(
  storedLocale: unknown,
  uiLanguage: string,
): SupportedLocale {
  if (isSupportedLocale(storedLocale)) return storedLocale;

  const normalized = uiLanguage.trim().replaceAll("_", "-").toLowerCase();
  if (normalized === "zh" || /^zh-(cn|sg|hans)(-|$)/.test(normalized)) {
    return "zh_CN";
  }

  const language = normalized.split("-")[0];
  const localeByLanguage: Partial<Record<string, SupportedLocale>> = {
    de: "de",
    en: "en",
    es: "es",
    fr: "fr",
    it: "it",
    ja: "ja",
    pt: "pt_BR",
  };
  return localeByLanguage[language ?? ""] ?? "en";
}

export function getLocaleTag(locale: SupportedLocale): string {
  return LOCALE_TAGS[locale];
}

export function bindLanguageSelector(
  select: HTMLSelectElement,
  currentLocale: SupportedLocale,
  save: (locale: SupportedLocale) => Promise<void>,
  reload: () => void,
): void {
  select.value = currentLocale;
  select.addEventListener("change", () => {
    const selectedLocale = select.value;
    if (!isSupportedLocale(selectedLocale)) {
      select.value = currentLocale;
      return;
    }

    void save(selectedLocale)
      .then(reload)
      .catch(() => {
        select.value = currentLocale;
      });
  });
}

function substitutionsArray(substitutions?: string | string[]): string[] {
  if (typeof substitutions === "string") return [substitutions];
  return substitutions ?? [];
}

export function createCatalogTranslator(
  catalog: LocaleCatalog,
  fallback: Translator = (key) => key,
): Translator {
  return (key, substitutions) => {
    const entry = catalog[key];
    if (!entry) return fallback(key, substitutions);

    const values = substitutionsArray(substitutions);
    return entry.message.replace(/\$([A-Z0-9_]+)\$/gi, (token, placeholderName) => {
      const placeholder = entry.placeholders?.[String(placeholderName).toLowerCase()];
      const position = placeholder?.content.match(/^\$(\d+)$/)?.[1];
      if (!position) return token;
      return values[Number(position) - 1] ?? "";
    });
  };
}

async function fetchCatalog(locale: SupportedLocale): Promise<LocaleCatalog> {
  const response = await fetch(
    chrome.runtime.getURL(`_locales/${locale}/messages.json`),
  );
  if (!response.ok) {
    throw new Error(`Could not load locale catalog: ${locale}`);
  }
  return (await response.json()) as LocaleCatalog;
}

export async function loadLocaleTranslator(
  locale: SupportedLocale,
): Promise<Translator> {
  const chromeFallback = createChromeTranslator();
  try {
    const englishCatalog = await fetchCatalog("en");
    const english = createCatalogTranslator(englishCatalog, chromeFallback);
    if (locale === "en") return english;

    const selectedCatalog = await fetchCatalog(locale);
    return createCatalogTranslator(selectedCatalog, english);
  } catch {
    return chromeFallback;
  }
}

export function applyTranslations(root: ParentNode, translate: Translator): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n;
    if (key) {
      element.textContent = translate(key);
    }
  });

  root.querySelectorAll<HTMLElement>("[data-i18n-aria-label]").forEach((element) => {
    const key = element.dataset.i18nAriaLabel;
    if (key) {
      element.setAttribute("aria-label", translate(key));
    }
  });
}
