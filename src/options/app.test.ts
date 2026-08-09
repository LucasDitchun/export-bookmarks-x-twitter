// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../settings/settings-repository";
import type { SendMessage, UiRequest } from "../shared/protocol";
import { createOptionsApp } from "./app";

const optionsHtml = readFileSync(resolve(process.cwd(), "options.html"), "utf8");
const translate = (key: string): string => key;

beforeEach(() => {
  document.open();
  document.write(optionsHtml);
  document.close();
});

describe("options app", () => {
  it("loads every settings group and saves a changed surface", async () => {
    const requests: UiRequest[] = [];
    const sendMessage = vi.fn(async (request: UiRequest) => {
      requests.push(request);
      if (request.type === "GET_SETTINGS") {
        return { ok: true as const, data: { settings: DEFAULT_SETTINGS } };
      }
      return {
        ok: true as const,
        data: {
          settings: {
            ...DEFAULT_SETTINGS,
            behavior: { ...DEFAULT_SETTINGS.behavior, surface: "sidePanel" },
          },
        },
      };
    }) as SendMessage;

    const app = createOptionsApp({ document, sendMessage, translate });
    await app.ready;
    expect(document.documentElement.dataset.settingsState).toBe("ready");
    expect(document.querySelectorAll("fieldset")).toHaveLength(5);
    const sidePanel = document.getElementById("surface-side-panel") as HTMLInputElement;
    sidePanel.checked = true;
    sidePanel.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(requests).toHaveLength(2));

    expect(requests[1]).toMatchObject({
      type: "SAVE_SETTINGS",
      payload: { settings: { behavior: { surface: "sidePanel" } } },
    });
    expect(document.getElementById("settings-status")?.textContent).toBe(
      "settingsSaved",
    );
    app.destroy();
  });

  it("uses native labelled controls and announces load failures", async () => {
    const sendMessage = vi.fn(async () => ({
      ok: false as const,
      error: { code: "storage_error", message: "private diagnostic" },
    })) as SendMessage;
    const app = createOptionsApp({ document, sendMessage, translate });
    await app.ready;
    expect(document.documentElement.dataset.settingsState).toBe("error");

    expect(document.querySelectorAll("input:not([aria-label])").length).toBeGreaterThan(
      0,
    );
    for (const input of Array.from(
      document.querySelectorAll<HTMLInputElement>("input"),
    )) {
      expect(document.querySelector(`label[for='${input.id}']`)).not.toBeNull();
    }
    expect(document.getElementById("settings-status")?.textContent).toBe(
      "settingsLoadError",
    );
    expect(document.body.textContent).not.toContain("private diagnostic");
    app.destroy();
  });

  it("maps every native control to a serializable settings patch", async () => {
    const requests: UiRequest[] = [];
    const sendMessage = vi.fn(async (request: UiRequest) => {
      requests.push(request);
      return {
        ok: true as const,
        data: { settings: structuredClone(DEFAULT_SETTINGS) },
      };
    }) as SendMessage;
    const app = createOptionsApp({ document, sendMessage, translate });
    await app.ready;

    const controlIds = [
      "appearance-large-text",
      "appearance-high-contrast",
      "appearance-reduce-motion",
      "surface-modal",
      "surface-side-panel",
      "behavior-prompt",
      "metadata-summary",
      "metadata-breadcrumb",
      "metadata-tags",
      "metadata-note",
      "metadata-category",
      "export-link",
      "export-text",
      "export-author",
      "export-date",
      "export-images",
      "export-videos",
      "export-note",
      "export-tags",
      "export-folder",
      "search-live-filter",
      "data-keep-archived",
    ];
    for (const id of controlIds) {
      const control = document.getElementById(id) as HTMLInputElement;
      control.checked = !control.checked;
      control.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await vi.waitFor(() => expect(requests).toHaveLength(controlIds.length + 1));

    expect(requests.slice(1)).toContainEqual({
      type: "SAVE_SETTINGS",
      payload: { settings: { export: { includeVideos: false } } },
    });
    expect(requests.slice(1)).toContainEqual({
      type: "SAVE_SETTINGS",
      payload: { settings: { behavior: { metadata: { note: false } } } },
    });
    app.destroy();
  });

  it("announces a save failure without exposing diagnostic details", async () => {
    const sendMessage = vi.fn(async (request: UiRequest) =>
      request.type === "GET_SETTINGS"
        ? { ok: true as const, data: { settings: DEFAULT_SETTINGS } }
        : {
            ok: false as const,
            error: { code: "storage_error", message: "private diagnostic" },
          },
    ) as SendMessage;
    const app = createOptionsApp({ document, sendMessage, translate });
    await app.ready;
    document
      .getElementById("behavior-prompt")
      ?.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() =>
      expect(document.getElementById("settings-status")?.textContent).toBe(
        "settingsSaveError",
      ),
    );
    expect(document.body.textContent).not.toContain("private diagnostic");
    app.destroy();
  });

  it("recovers its save queue after a rejected runtime message", async () => {
    let saveAttempt = 0;
    const sendMessage = vi.fn(async (request: UiRequest) => {
      if (request.type === "GET_SETTINGS") {
        return { ok: true as const, data: { settings: DEFAULT_SETTINGS } };
      }
      saveAttempt += 1;
      if (saveAttempt === 1) throw new Error("service worker restarted");
      return {
        ok: true as const,
        data: {
          settings: {
            ...structuredClone(DEFAULT_SETTINGS),
            behavior: {
              ...structuredClone(DEFAULT_SETTINGS.behavior),
              metadata: {
                ...structuredClone(DEFAULT_SETTINGS.behavior.metadata),
                note: false,
              },
            },
          },
        },
      };
    }) as SendMessage;
    const app = createOptionsApp({ document, sendMessage, translate });
    await app.ready;

    document
      .getElementById("behavior-prompt")
      ?.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() =>
      expect(document.getElementById("settings-status")?.textContent).toBe(
        "settingsSaveError",
      ),
    );
    const note = document.getElementById("metadata-note") as HTMLInputElement;
    note.checked = false;
    note.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() =>
      expect(document.getElementById("settings-status")?.textContent).toBe(
        "settingsSaved",
      ),
    );

    expect(saveAttempt).toBe(2);
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: "SAVE_SETTINGS",
      payload: { settings: { behavior: { metadata: { note: false } } } },
    });
    app.destroy();
  });
});
