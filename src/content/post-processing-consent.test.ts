import { describe, expect, it, vi } from "vitest";

import { createPostProcessingConsentGate } from "./post-processing-consent";

describe("post-processing consent gate", () => {
  it("does not start post processing before the disclosure is accepted", async () => {
    let resolveStatus: ((accepted: boolean) => void) | undefined;
    const loadAccepted = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveStatus = resolve;
        }),
    );
    const stop = vi.fn();
    const start = vi.fn(() => ({ stop }));
    const gate = createPostProcessingConsentGate({ loadAccepted, start });

    const initialized = gate.initialize();
    expect(start).not.toHaveBeenCalled();

    resolveStatus?.(false);
    await initialized;
    expect(start).not.toHaveBeenCalled();

    gate.enable();
    expect(start).toHaveBeenCalledOnce();

    gate.enable();
    expect(start).toHaveBeenCalledOnce();
  });

  it("starts immediately when the current disclosure was already accepted", async () => {
    const start = vi.fn(() => ({ stop: vi.fn() }));
    const gate = createPostProcessingConsentGate({
      loadAccepted: vi.fn(async () => true),
      start,
    });

    await gate.initialize();

    expect(start).toHaveBeenCalledOnce();
  });

  it("retries a transient status failure before leaving an accepted tab inactive", async () => {
    const start = vi.fn(() => ({ stop: vi.fn() }));
    const retryDelay = vi.fn(async () => undefined);
    const loadAccepted = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("service worker restarted"))
      .mockResolvedValueOnce(true);
    const gate = createPostProcessingConsentGate({
      loadAccepted,
      start,
      retryDelay,
    });

    await gate.initialize();

    expect(loadAccepted).toHaveBeenCalledTimes(2);
    expect(retryDelay).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
  });

  it("never starts after the page runtime is stopped", async () => {
    let resolveStatus: ((accepted: boolean) => void) | undefined;
    const start = vi.fn(() => ({ stop: vi.fn() }));
    const gate = createPostProcessingConsentGate({
      loadAccepted: () =>
        new Promise<boolean>((resolve) => {
          resolveStatus = resolve;
        }),
      start,
    });
    const initialized = gate.initialize();

    gate.stop();
    resolveStatus?.(true);
    await initialized;

    expect(start).not.toHaveBeenCalled();
  });
});
