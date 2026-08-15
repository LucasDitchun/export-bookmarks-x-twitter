import { describe, expect, it, vi } from "vitest";

import {
  createSemanticModelAccess,
  SEMANTIC_MODEL_ORIGINS,
} from "./semantic-model-access";

describe("semantic model access boundary", () => {
  it("scopes contains, request, and remove to the two optional model origins", async () => {
    const permissions = {
      contains: vi.fn(async () => false),
      request: vi.fn(async () => true),
      remove: vi.fn(async () => true),
    };
    const access = createSemanticModelAccess(permissions);

    await expect(access.contains()).resolves.toBe(false);
    await expect(access.request()).resolves.toBe(true);
    await expect(access.remove()).resolves.toBe(true);

    expect(SEMANTIC_MODEL_ORIGINS).toEqual([
      "https://huggingface.co/*",
      "https://*.cdn.hf.co/*",
    ]);
    for (const method of [
      permissions.contains,
      permissions.request,
      permissions.remove,
    ]) {
      expect(method).toHaveBeenCalledWith({ origins: [...SEMANTIC_MODEL_ORIGINS] });
    }
  });
});
