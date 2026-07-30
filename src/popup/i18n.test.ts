// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { SupportedLocale } from "../domain/types";
import {
  bindLanguageSelector,
  createCatalogTranslator,
  getLocaleTag,
  resolvePreferredLocale,
} from "./i18n";

const supportedLocales: SupportedLocale[] = [
  "en",
  "pt_BR",
  "ja",
  "es",
  "zh_CN",
  "de",
  "fr",
  "it",
];

describe("popup localization", () => {
  it.each([
    ["en-US", "en"],
    ["pt-BR", "pt_BR"],
    ["pt-PT", "pt_BR"],
    ["ja-JP", "ja"],
    ["es-MX", "es"],
    ["zh-CN", "zh_CN"],
    ["zh-Hans", "zh_CN"],
    ["de-DE", "de"],
    ["fr-CA", "fr"],
    ["it-IT", "it"],
    ["ko-KR", "en"],
    ["zh-TW", "en"],
    ["", "en"],
  ] as const)("maps Chrome language %s to %s", (uiLanguage, expected) => {
    expect(resolvePreferredLocale(undefined, uiLanguage)).toBe(expected);
  });

  it("uses a valid saved preference and ignores unsupported stored values", () => {
    expect(resolvePreferredLocale("ja", "pt-BR")).toBe("ja");
    expect(resolvePreferredLocale("invalid", "pt-BR")).toBe("pt_BR");
  });

  it("maps extension locale codes to valid document and Intl language tags", () => {
    expect(supportedLocales.map(getLocaleTag)).toEqual([
      "en",
      "pt-BR",
      "ja",
      "es",
      "zh-CN",
      "de",
      "fr",
      "it",
    ]);
  });

  it("translates Chrome placeholders and falls back to English messages", () => {
    const english = createCatalogTranslator({
      missingInSelected: { message: "English fallback" },
    });
    const translate = createCatalogTranslator(
      {
        count: {
          message: "$COUNT$ saved",
          placeholders: { count: { content: "$1" } },
        },
      },
      english,
    );

    expect(translate("count", "42")).toBe("42 saved");
    expect(translate("missingInSelected")).toBe("English fallback");
    expect(translate("unknownKey")).toBe("unknownKey");
  });

  it("persists a manual language selection before reloading the popup", async () => {
    document.body.innerHTML = `
      <select id="language">
        <option value="en">English</option>
        <option value="fr">Français</option>
      </select>
    `;
    const select = document.getElementById("language") as HTMLSelectElement;
    const save = vi.fn<(locale: SupportedLocale) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const reload = vi.fn();
    bindLanguageSelector(select, "en", save, reload);

    select.value = "fr";
    select.dispatchEvent(new Event("change"));

    await vi.waitFor(() => expect(save).toHaveBeenCalledWith("fr"));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("keeps every locale catalog aligned with the English source", () => {
    const readCatalog = (locale: SupportedLocale): Record<string, unknown> =>
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), `public/_locales/${locale}/messages.json`),
          "utf8",
        ),
      ) as Record<string, unknown>;
    const expectedKeys = Object.keys(readCatalog("en")).sort();

    for (const locale of supportedLocales) {
      expect(Object.keys(readCatalog(locale)).sort(), locale).toEqual(expectedKeys);
    }
  });
});
