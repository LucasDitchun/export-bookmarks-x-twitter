import { describe, expect, it, vi } from "vitest";

import { createLocaleCatalogCache } from "./locale-catalog-cache";

describe("createLocaleCatalogCache", () => {
  it("retries a rejected locale load and caches the later success", async () => {
    const messages = { bookmarkPromptTitle: "Salvar bookmark" };
    const loadCatalog = vi
      .fn<(locale: string) => Promise<Record<string, string>>>()
      .mockRejectedValueOnce(new Error("temporary read failure"))
      .mockResolvedValue(messages);
    const getCatalog = createLocaleCatalogCache(loadCatalog);

    await expect(getCatalog("pt_BR")).rejects.toThrow("temporary read failure");
    await expect(getCatalog("pt_BR")).resolves.toBe(messages);
    await expect(getCatalog("pt_BR")).resolves.toBe(messages);

    expect(loadCatalog).toHaveBeenCalledTimes(2);
    expect(loadCatalog).toHaveBeenNthCalledWith(1, "pt_BR");
    expect(loadCatalog).toHaveBeenNthCalledWith(2, "pt_BR");
  });
});
