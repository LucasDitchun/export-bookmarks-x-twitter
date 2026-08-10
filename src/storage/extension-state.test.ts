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
      mode: "full",
      checkpointIds: [],
      checkpointCandidates: ["12", "11"],
      checkpointMatchIds: [],
      completionReason: null,
    };

    await repository.setScrapeRun(run);
    await expect(repository.getScrapeRun()).resolves.toEqual({
      ...run,
      quickStopThreshold: 15,
    });
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

  it("normalizes a capture persisted before incremental updates as a full run", async () => {
    const storage = new MemoryStorageArea();
    await storage.set({
      scrapeRun: {
        id: "legacy-run",
        tabId: 7,
        status: "completed",
        fetched: 12,
        added: 12,
        updated: 0,
        startedAt: "2026-07-29T12:00:00.000Z",
        updatedAt: "2026-07-29T12:01:00.000Z",
        errorCode: null,
      },
    });

    await expect(
      new ExtensionStateRepository(storage).getScrapeRun(),
    ).resolves.toMatchObject({
      mode: "full",
      checkpointIds: [],
      checkpointCandidates: [],
      checkpointMatchIds: [],
      completionReason: null,
    });
  });

  it("persists unique recent checkpoint IDs and clears them independently", async () => {
    const repository = new ExtensionStateRepository(new MemoryStorageArea());

    await repository.setScrapeCheckpoints({
      ids: ["12", "11", "10", "9", "8", "7", "6", "5", "4", "3"],
      updatedAt: "2026-07-29T12:05:00.000Z",
    });

    await expect(repository.getScrapeCheckpoints()).resolves.toEqual({
      ids: ["12", "11", "10", "9", "8", "7", "6", "5", "4", "3"],
      updatedAt: "2026-07-29T12:05:00.000Z",
    });
    await repository.clearScrapeCheckpoints();
    await expect(repository.getScrapeCheckpoints()).resolves.toBeNull();
  });

  it.each([
    { ids: [], updatedAt: "2026-07-29T12:05:00.000Z" },
    { ids: ["1", "1"], updatedAt: "2026-07-29T12:05:00.000Z" },
    {
      ids: Array.from({ length: 51 }, (_, index) => String(index + 1)),
      updatedAt: "2026-07-29T12:05:00.000Z",
    },
    { ids: ["not-an-id"], updatedAt: "2026-07-29T12:05:00.000Z" },
    { ids: ["1"], updatedAt: "not-a-date" },
  ])("ignores malformed checkpoint state %#", async (checkpointState) => {
    const storage = new MemoryStorageArea();
    await storage.set({ scrapeCheckpoints: checkpointState });

    await expect(
      new ExtensionStateRepository(storage).getScrapeCheckpoints(),
    ).resolves.toBeNull();
  });
});
