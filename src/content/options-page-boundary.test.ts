import { describe, expect, it, vi } from "vitest";

import { openOptionsPageSafely } from "./options-page-boundary";

describe("openOptionsPageSafely", () => {
  it("contains synchronous and asynchronous extension-boundary failures", async () => {
    const syncFailure = vi.fn(() => {
      throw new Error("Extension context invalidated");
    });
    const asyncFailure = vi.fn(() => Promise.reject(new Error("Tab closed")));

    expect(() => openOptionsPageSafely(syncFailure)).not.toThrow();
    expect(() => openOptionsPageSafely(asyncFailure)).not.toThrow();
    await Promise.resolve();

    expect(syncFailure).toHaveBeenCalledOnce();
    expect(asyncFailure).toHaveBeenCalledOnce();
  });
});
