import { describe, expect, it, vi } from "vitest";

import { waitForExtensionContext } from "./chrome-smoke-readiness.mjs";

describe("Chrome smoke extension context readiness", () => {
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
