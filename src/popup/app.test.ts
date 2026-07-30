// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PopupStatus, SendMessage } from "./protocol";
import { createPopupApp } from "./app";

const popupHtml = readFileSync(resolve(process.cwd(), "popup.html"), "utf8");
const translate = (key: string, substitutions?: string | string[]): string => {
  const values = typeof substitutions === "string" ? [substitutions] : substitutions;
  return values?.length ? `${key}:${values.join("|")}` : key;
};

const emptyStatus: PopupStatus = {
  pageReady: false,
  stats: {
    total: 0,
    current: 0,
    archived: 0,
    lastSuccessfulSyncAt: null,
  },
  scrape: null,
};

const readyStatus: PopupStatus = {
  pageReady: true,
  stats: {
    total: 42,
    current: 40,
    archived: 2,
    lastSuccessfulSyncAt: "2026-07-29T10:00:00.000Z",
  },
  scrape: {
    id: "run-1",
    tabId: 7,
    status: "completed",
    fetched: 42,
    added: 40,
    updated: 2,
    startedAt: "2026-07-29T10:00:00.000Z",
    updatedAt: "2026-07-29T10:01:00.000Z",
    errorCode: null,
  },
};

beforeEach(() => {
  document.open();
  document.write(popupHtml);
  document.close();
});

describe("popup app", () => {
  it("guides the user to open the bookmarks page before capture", async () => {
    const requests: string[] = [];
    const sendMessage = ((request) => {
      requests.push(request.type);
      return Promise.resolve(
        request.type === "GET_STATUS"
          ? { ok: true as const, data: emptyStatus }
          : { ok: true as const, data: undefined },
      );
    }) as SendMessage;
    const app = createPopupApp({ document, locale: "en", sendMessage, translate });
    await app.ready;

    expect(document.getElementById("page-guidance")?.textContent).toBe(
      "pageMissingGuidance",
    );
    const captureButton = document.getElementById(
      "capture-button",
    ) as HTMLButtonElement;
    expect(captureButton.disabled).toBe(true);
    expect(captureButton.hidden).toBe(true);

    document.getElementById("open-bookmarks-button")?.click();
    await vi.waitFor(() => expect(requests).toContain("OPEN_BOOKMARKS"));
    app.destroy();
  });

  it("captures from a ready page and renders archive totals", async () => {
    const requests: string[] = [];
    const sendMessage = ((request) => {
      requests.push(request.type);
      return Promise.resolve(
        request.type === "GET_STATUS"
          ? { ok: true as const, data: readyStatus }
          : { ok: true as const, data: undefined },
      );
    }) as SendMessage;
    const app = createPopupApp({ document, locale: "en", sendMessage, translate });
    await app.ready;

    expect(document.getElementById("total-count")?.textContent).toBe("42");
    expect(document.getElementById("capture-state")?.textContent).toBe(
      "captureComplete",
    );
    document.getElementById("capture-button")?.click();
    await vi.waitFor(() => expect(requests).toContain("START_SCRAPE"));
    app.destroy();
  });

  it("shows how many existing bookmarks were skipped as duplicates", async () => {
    const sendMessage = (() =>
      Promise.resolve({ ok: true as const, data: readyStatus })) as SendMessage;
    const app = createPopupApp({ document, locale: "en", sendMessage, translate });
    await app.ready;

    const duplicateSummary = document.getElementById("duplicate-summary");
    expect(duplicateSummary?.hidden).toBe(false);
    expect(duplicateSummary?.textContent).toBe("duplicatesSkipped:2");
    app.destroy();
  });

  it("shows live progress and allows a running capture to be cancelled", async () => {
    const runningStatus: PopupStatus = {
      ...readyStatus,
      pageReady: false,
      scrape: { ...readyStatus.scrape!, status: "running", fetched: 18 },
    };
    const requests: string[] = [];
    const sendMessage = ((request) => {
      requests.push(request.type);
      return Promise.resolve(
        request.type === "GET_STATUS"
          ? { ok: true as const, data: runningStatus }
          : { ok: true as const, data: undefined },
      );
    }) as SendMessage;
    const app = createPopupApp({ document, locale: "en", sendMessage, translate });
    await app.ready;

    expect(document.getElementById("capture-progress")?.hidden).toBe(false);
    expect(document.getElementById("capture-progress-copy")?.textContent).toBe(
      "captureProgress:18",
    );
    const button = document.getElementById("capture-button") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    button.click();
    await vi.waitFor(() => expect(requests).toContain("CANCEL_SCRAPE"));
    app.destroy();
  });

  it("exports TXT and announces localized safe errors", async () => {
    const createDownload = vi.fn();
    let shouldFail = false;
    const sendMessage = ((request) => {
      if (request.type === "GET_STATUS") {
        return Promise.resolve({ ok: true as const, data: readyStatus });
      }
      if (shouldFail) {
        return Promise.resolve({
          ok: false as const,
          error: { code: "content_script_unavailable", message: "raw detail" },
        });
      }
      return Promise.resolve({
        ok: true as const,
        data: { content: "\uFEFFarchive", filename: "bookmark-x.txt" },
      });
    }) as SendMessage;
    const app = createPopupApp({
      document,
      locale: "pt_BR",
      sendMessage,
      translate,
      createDownload,
    });
    await app.ready;

    document.getElementById("export-full-button")?.click();
    await vi.waitFor(() =>
      expect(createDownload).toHaveBeenCalledWith({
        content: "\uFEFFarchive",
        filename: "bookmark-x.txt",
      }),
    );

    shouldFail = true;
    document.getElementById("capture-button")?.click();
    await vi.waitFor(() => {
      expect(document.getElementById("alert")?.textContent).toBe("errorReloadPage");
      expect(document.getElementById("alert")?.textContent).not.toContain("raw detail");
    });
    app.destroy();
  });
});
