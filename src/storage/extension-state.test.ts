import { describe, expect, it } from "vitest";

import type { ScrapeRun } from "../domain/types";
import { ExtensionStateRepository } from "./extension-state";

class MemoryStorageArea {
  private readonly values: Record<string, unknown> = {};

  async get(keys: string | string[]): Promise<Record<string, unknown>> {
    const requested = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(
      requested
        .filter((key) => key in this.values)
        .map((key) => [key, this.values[key]]),
    );
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, items);
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete this.values[key];
  }
}

describe("ExtensionStateRepository", () => {
  it("persists and clears a validated capture checkpoint", async () => {
    const repository = new ExtensionStateRepository(new MemoryStorageArea());
    const run: ScrapeRun = {
      id: "run-1",
      tabId: 7,
      status: "running",
      fetched: 12,
      added: 8,
      updated: 4,
      startedAt: "2026-07-29T12:00:00.000Z",
      updatedAt: "2026-07-29T12:00:01.000Z",
      errorCode: null,
    };

    await repository.setScrapeRun(run);
    await expect(repository.getScrapeRun()).resolves.toEqual(run);
    await repository.clearScrapeRun();
    await expect(repository.getScrapeRun()).resolves.toBeNull();
  });

  it("ignores malformed data left in extension storage", async () => {
    const storage = new MemoryStorageArea();
    await storage.set({ scrapeRun: { id: "missing-fields" } });

    await expect(
      new ExtensionStateRepository(storage).getScrapeRun(),
    ).resolves.toBeNull();
  });
});
