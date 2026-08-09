// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SemanticSearchState } from "../semantic/semantic-state-repository";
import { SemanticOperationCancelledError } from "../semantic/semantic-search-client";
import { createSemanticOptionsUi } from "./semantic-options-ui";

const readyState: SemanticSearchState = {
  enabled: true,
  consentGrantedAt: "2026-08-09T10:00:00.000Z",
  modelStatus: "ready",
  backend: "wasm",
  indexedBookmarks: 772,
  updatedAt: "2026-08-09T10:00:00.000Z",
  errorCode: null,
};

function markup(): void {
  document.body.innerHTML = `
    <input id="semantic-enabled" type="checkbox">
    <button id="semantic-install" type="button"></button>
    <button id="semantic-cancel" type="button"></button>
    <button id="semantic-reindex" type="button"></button>
    <button id="semantic-remove" type="button"></button>
    <progress id="semantic-progress" max="100"></progress>
    <p id="semantic-progress-copy"></p>
    <p id="semantic-status" role="status" aria-live="polite"></p>
    <p id="semantic-storage"></p>`;
}

describe("semantic search options", () => {
  beforeEach(markup);

  it("shows explicit consent controls and storage estimates before any download", async () => {
    const install = vi.fn(async () => readyState);
    const client = {
      getState: vi.fn(async (): Promise<SemanticSearchState> => ({
        enabled: false,
        consentGrantedAt: null,
        modelStatus: "notInstalled",
        backend: null,
        indexedBookmarks: 0,
        updatedAt: null,
        errorCode: null,
      })),
      installWithConsent: install,
      reindex: vi.fn(),
      cancel: vi.fn(),
      remove: vi.fn(),
      setEnabled: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    };
    const ui = createSemanticOptionsUi({
      document,
      client,
      translate: (key, ...args) => `${key}:${args.join(",")}`,
      estimateStorage: async () => ({ usage: 50, quota: 200 }),
    });
    await ui.ready;

    expect(document.getElementById("semantic-install")?.hidden).toBe(false);
    expect(document.getElementById("semantic-reindex")?.hidden).toBe(true);
    expect(document.getElementById("semantic-storage")?.textContent).toBe(
      "semanticStorageEstimate:50 B,200 B",
    );
    expect(install).not.toHaveBeenCalled();
  });

  it("installs only on the explicit button, announces progress, and exposes lifecycle actions", async () => {
    let listener: (value: {
      phase: "downloading";
      completed: number;
      total: number;
    }) => void = () => {};
    const client = {
      getState: vi.fn(async () => ({
        ...readyState,
        modelStatus: "notInstalled" as const,
      })),
      installWithConsent: vi.fn(async () => readyState),
      reindex: vi.fn(async () => readyState),
      cancel: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      setEnabled: vi.fn(async (enabled: boolean) => ({ ...readyState, enabled })),
      subscribe: vi.fn((next: typeof listener) => {
        listener = next;
        return () => {};
      }),
    };
    const ui = createSemanticOptionsUi({
      document,
      client,
      translate: (key, ...args) => `${key}:${args.join(",")}`,
      estimateStorage: async () => ({}),
    });
    await ui.ready;
    document.getElementById("semantic-install")?.click();
    listener({ phase: "downloading", completed: 50, total: 100 });
    await vi.waitFor(() => expect(client.installWithConsent).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(document.getElementById("semantic-status")?.textContent).toContain(
        "semanticReady:WASM,772",
      ),
    );
    expect(
      (document.getElementById("semantic-progress") as HTMLProgressElement).value,
    ).toBe(50);
    expect(document.getElementById("semantic-reindex")?.hidden).toBe(false);
    expect(document.getElementById("semantic-remove")?.hidden).toBe(false);
    ui.destroy();
  });

  it("cancels, removes, and toggles without losing accessible status feedback", async () => {
    const client = {
      getState: vi.fn(async () => readyState),
      installWithConsent: vi.fn(),
      reindex: vi.fn(async () => readyState),
      cancel: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
      setEnabled: vi.fn(async (enabled: boolean) => ({ ...readyState, enabled })),
      subscribe: vi.fn(() => () => {}),
    };
    const ui = createSemanticOptionsUi({
      document,
      client,
      translate: (key) => key,
      estimateStorage: async () => ({}),
    });
    await ui.ready;
    const enabled = document.getElementById("semantic-enabled") as HTMLInputElement;
    enabled.checked = false;
    enabled.dispatchEvent(new Event("change"));
    document.getElementById("semantic-remove")?.click();

    await vi.waitFor(() => expect(client.setEnabled).toHaveBeenCalledWith(false));
    await vi.waitFor(() => expect(client.remove).toHaveBeenCalledOnce());
    expect(document.getElementById("semantic-status")?.getAttribute("aria-live")).toBe(
      "polite",
    );
    ui.destroy();
  });

  it("keeps an install failure announced after restoring the controls", async () => {
    const client = {
      getState: vi.fn(async () => ({
        ...readyState,
        enabled: false,
        consentGrantedAt: null,
        modelStatus: "notInstalled" as const,
        backend: null,
        indexedBookmarks: 0,
      })),
      installWithConsent: vi.fn(async () => {
        throw new Error("offline");
      }),
      reindex: vi.fn(),
      cancel: vi.fn(),
      remove: vi.fn(),
      setEnabled: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    };
    const ui = createSemanticOptionsUi({
      document,
      client,
      translate: (key) => key,
      estimateStorage: async () => ({}),
    });
    await ui.ready;
    document.getElementById("semantic-install")?.click();

    await vi.waitFor(() =>
      expect(document.getElementById("semantic-status")?.textContent).toBe(
        "semanticInstallError",
      ),
    );
    expect(
      (document.getElementById("semantic-install") as HTMLButtonElement).disabled,
    ).toBe(false);
    ui.destroy();
  });

  it("treats a user-cancelled download as cancellation instead of an install error", async () => {
    const notInstalled = {
      ...readyState,
      enabled: false,
      consentGrantedAt: null,
      modelStatus: "notInstalled" as const,
      backend: null,
      indexedBookmarks: 0,
    };
    const client = {
      getState: vi.fn(async () => notInstalled),
      installWithConsent: vi.fn(async () => {
        throw new SemanticOperationCancelledError();
      }),
      reindex: vi.fn(),
      cancel: vi.fn(async () => {}),
      remove: vi.fn(),
      setEnabled: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    };
    const ui = createSemanticOptionsUi({
      document,
      client,
      translate: (key) => key,
      estimateStorage: async () => ({}),
    });
    await ui.ready;
    document.getElementById("semantic-install")?.click();

    await vi.waitFor(() => expect(client.installWithConsent).toHaveBeenCalledOnce());
    expect(document.getElementById("semantic-status")?.textContent).toBe(
      "semanticNotInstalled",
    );
    ui.destroy();
  });
});
