import { describe, expect, it, vi } from "vitest";

import {
  createLocaleRefreshBroadcaster,
  isLocaleStorageChange,
  X_TAB_URL_PATTERNS,
} from "./locale-refresh";

describe("createLocaleRefreshBroadcaster", () => {
  it("accepts only the selected locale key from local storage", () => {
    const locale = { uiLocale: { oldValue: "en", newValue: "pt_BR" } };
    expect(isLocaleStorageChange(locale, "local", "uiLocale")).toBe(true);
    expect(isLocaleStorageChange(locale, "sync", "uiLocale")).toBe(false);
    expect(
      isLocaleStorageChange({ settings: { newValue: {} } }, "local", "uiLocale"),
    ).toBe(false);
  });

  it("coalesces locale changes and notifies only tabs matched by X URL patterns", async () => {
    const localization = {
      locale: "pt_BR" as const,
      messages: { bookmarkPromptTitle: "Por que você está salvando isto?" },
    };
    const queryTabs = vi.fn(async () => [
      { id: 7, url: "https://x.com/home" },
      { id: undefined, url: "https://x.com/explore" },
    ]);
    const sendToTab = vi.fn(async () => undefined);
    const schedule = createLocaleRefreshBroadcaster({
      loadLocalization: vi.fn(async () => localization),
      queryTabs,
      sendToTab,
    });

    await Promise.all([schedule(), schedule(), schedule()]);

    expect(queryTabs).toHaveBeenCalledOnce();
    expect(queryTabs).toHaveBeenCalledWith({ url: X_TAB_URL_PATTERNS });
    expect(sendToTab).toHaveBeenCalledOnce();
    expect(sendToTab).toHaveBeenCalledWith(7, {
      type: "REFRESH_BOOKMARK_LOCALIZATION",
      localization,
    });
  });
});
