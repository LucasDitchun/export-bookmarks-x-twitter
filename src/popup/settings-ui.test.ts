// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  type ExtensionSettings,
} from "../settings/settings-repository";
import { applyLibraryUiSettings, createSettingsUiController } from "./settings-ui";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function withMetadata(enabled: boolean): ExtensionSettings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    behavior: {
      ...structuredClone(DEFAULT_SETTINGS.behavior),
      metadata: {
        summary: enabled,
        breadcrumb: enabled,
        tags: enabled,
        note: enabled,
        categoryIndicator: enabled,
      },
    },
  };
}

beforeEach(() => {
  document.documentElement.removeAttribute("style");
  document.documentElement.replaceChildren(
    document.createElement("head"),
    document.createElement("body"),
  );
});

describe("shared library settings UI", () => {
  it("scales every declared popup font from the root large-text setting", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/popup/styles.css"), "utf8");

    expect(styles).toContain('html[data-large-text="true"]');
    expect(styles).toContain("font-size: 112.5%");
    expect(styles).not.toMatch(/font-size:\s*[0-9.]+px/u);
    expect(styles.match(/font-size:\s*[0-9.]+rem/gu)?.length).toBeGreaterThan(20);

    const style = document.createElement("style");
    style.textContent = styles;
    document.head.append(style);
    applyLibraryUiSettings(document, {
      ...structuredClone(DEFAULT_SETTINGS),
      appearance: {
        ...structuredClone(DEFAULT_SETTINGS.appearance),
        largeText: false,
      },
    });
    expect(getComputedStyle(document.documentElement).fontSize).toBe("100%");
    applyLibraryUiSettings(document, structuredClone(DEFAULT_SETTINGS));
    expect(getComputedStyle(document.documentElement).fontSize).toBe("112.5%");
  });

  it("turns each metadata surface off and back on without parsing its text", () => {
    const popupHtml = readFileSync(resolve(process.cwd(), "popup.html"), "utf8");
    document.open();
    document.write(popupHtml);
    document.close();
    const styles = readFileSync(resolve(process.cwd(), "src/popup/styles.css"), "utf8");
    const style = document.createElement("style");
    style.textContent = styles;
    document.head.append(style);
    const metadataKeys = ["summary", "breadcrumb", "tags", "note", "categoryIndicator"];
    for (const key of metadataKeys) {
      const element = document.querySelector<HTMLElement>(
        `[data-bookmark-metadata="${key}"]`,
      );
      expect(element).not.toBeNull();
      element?.append(document.createTextNode('<img src=x onerror="alert(1)">'));
    }

    applyLibraryUiSettings(document, withMetadata(false));
    for (const element of Array.from(
      document.querySelectorAll<HTMLElement>("[data-bookmark-metadata]"),
    )) {
      expect(getComputedStyle(element).display).toBe("none");
      expect(element.querySelector("img")).toBeNull();
    }

    applyLibraryUiSettings(document, withMetadata(true));
    for (const element of Array.from(
      document.querySelectorAll<HTMLElement>("[data-bookmark-metadata]"),
    )) {
      expect(getComputedStyle(element).display).not.toBe("none");
      expect(element.textContent).toContain("<img src=x");
    }
  });

  it("does not let a stale settings response overwrite a newer refresh", async () => {
    const stale = deferred<ExtensionSettings | null>();
    const current = deferred<ExtensionSettings | null>();
    const pending = [stale, current];
    const controller = createSettingsUiController({
      document,
      load: () => pending.shift()!.promise,
    });

    const staleRefresh = controller.refresh();
    const currentRefresh = controller.refresh();
    current.resolve(withMetadata(true));
    await currentRefresh;
    stale.resolve(withMetadata(false));
    await staleRefresh;

    expect(document.documentElement.dataset.metadataSummary).toBe("true");
    expect(document.documentElement.dataset.metadataCategoryIndicator).toBe("true");
    controller.destroy();
  });
});
