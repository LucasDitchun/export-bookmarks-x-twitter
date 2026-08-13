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
    const invalidateLocalization = vi.fn();
    const schedule = createLocaleRefreshBroadcaster({
      invalidateLocalization,
      loadLocalization: vi.fn(async () => localization),
      queryTabs,
      sendToTab,
    });

    await Promise.all([schedule(), schedule(), schedule()]);

    expect(queryTabs).toHaveBeenCalledOnce();
    expect(invalidateLocalization).toHaveBeenCalledOnce();
    expect(queryTabs).toHaveBeenCalledWith({ url: X_TAB_URL_PATTERNS });
    expect(sendToTab).toHaveBeenCalledOnce();
    expect(sendToTab).toHaveBeenCalledWith(7, {
      type: "REFRESH_BOOKMARK_LOCALIZATION",
      localization,
    });
  });

  it("retries a queued locale change after an in-flight catalog load fails", async () => {
    let rejectFirst!: (reason: Error) => void;
    const firstLoad = new Promise<never>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const localization = {
      locale: "de" as const,
      messages: { bookmarkPromptTitle: "Warum speichern Sie das?" },
    };
    const loadLocalization = vi
      .fn<() => Promise<typeof localization>>()
      .mockImplementationOnce(() => firstLoad)
      .mockResolvedValueOnce(localization);
    const sendToTab = vi.fn(async () => undefined);
    const schedule = createLocaleRefreshBroadcaster({
      invalidateLocalization: vi.fn(),
      loadLocalization,
      queryTabs: vi.fn(async () => [{ id: 9, url: "https://x.com/home" }]),
      sendToTab,
    });

    const first = schedule();
    await vi.waitFor(() => expect(loadLocalization).toHaveBeenCalledOnce());
    const queued = schedule();
    rejectFirst(new Error("transient catalog failure"));

    await expect(Promise.all([first, queued])).resolves.toEqual([undefined, undefined]);
    expect(loadLocalization).toHaveBeenCalledTimes(2);
    expect(sendToTab).toHaveBeenCalledOnce();
    expect(sendToTab).toHaveBeenCalledWith(9, {
      type: "REFRESH_BOOKMARK_LOCALIZATION",
      localization,
    });
  });
});
