import { describe, expect, it, vi } from "vitest";

import {
  extensionDebugArguments,
  isUnbrandedChromiumVersion,
  loadUnpackedExtension,
  navigateToExtensionContext,
  waitForExtensionContext,
} from "./chrome-smoke-readiness.mjs";

describe("Chrome smoke extension context readiness", () => {
  it("enables the DevTools extension domain without legacy sideload flags", () => {
    expect(extensionDebugArguments()).toEqual(["--enable-unsafe-extension-debugging"]);
  });

  it("accepts unbranded Chromium and rejects branded Chrome executables", () => {
    expect(isUnbrandedChromiumVersion("Chromium 150.0.7871.0")).toBe(true);
    expect(isUnbrandedChromiumVersion("Chromium 150.0.7871.0 snap")).toBe(true);
    expect(isUnbrandedChromiumVersion("Google Chrome 150.0.7871.128")).toBe(false);
    expect(isUnbrandedChromiumVersion("Google Chrome for Testing 150.0.7871.0")).toBe(
      false,
    );
    expect(isUnbrandedChromiumVersion("")).toBe(false);
  });

  it("loads the unpacked extension through the browser DevTools target", async () => {
    const send = vi.fn().mockResolvedValue({ id: "extension-id" });

    await expect(loadUnpackedExtension({ send }, "/tmp/bookmark-x/dist")).resolves.toBe(
      "extension-id",
    );

    expect(send).toHaveBeenCalledWith("Extensions.loadUnpacked", {
      path: "/tmp/bookmark-x/dist",
    });
  });

  it("rejects a DevTools response without an extension id", async () => {
    const send = vi.fn().mockResolvedValue({});

    await expect(
      loadUnpackedExtension({ send }, "/tmp/bookmark-x/dist"),
    ).rejects.toThrow("extension id");
  });

  it("attaches to a neutral target before navigating to an extension page", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ result: { value: true } });
    const url = "chrome-extension://example/popup.html";

    await navigateToExtensionContext({ send }, url);

    expect(send.mock.calls.map(([method]) => method)).toEqual([
      "Page.enable",
      "Page.navigate",
      "Runtime.evaluate",
    ]);
    expect(send.mock.calls[1]?.[1]).toEqual({ url });
  });

  it("waits through navigation races until the extension storage API is ready", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("Execution context was destroyed"))
      .mockResolvedValueOnce({ result: { value: false } })
      .mockResolvedValueOnce({ result: { value: true } });

    await waitForExtensionContext({ send }, "chrome-extension://example/options.html", {
      delay: vi.fn(),
      timeoutMilliseconds: 1_000,
    });

    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.at(-1)?.[1]).toMatchObject({
      awaitPromise: true,
      returnByValue: true,
    });
  });

  it("fails with the expected URL when the extension context never becomes ready", async () => {
    const send = vi.fn().mockResolvedValue({ result: { value: false } });
    let now = 0;

    await expect(
      waitForExtensionContext({ send }, "chrome-extension://example/options.html", {
        delay: async () => {
          now += 100;
        },
        now: () => now,
        timeoutMilliseconds: 250,
      }),
    ).rejects.toThrow("chrome-extension://example/options.html");
  });
});
