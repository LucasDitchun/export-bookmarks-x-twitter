import { describe, expect, it } from "vitest";

import {
  DEFAULT_SEMANTIC_STATE,
  SEMANTIC_STATE_KEY,
  SemanticStateRepository,
} from "./semantic-state-repository";

class MemoryStorage {
  values: Record<string, unknown> = {};

  async get(key: string): Promise<Record<string, unknown>> {
    return { [key]: this.values[key] };
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, structuredClone(items));
  }
}

describe("SemanticStateRepository", () => {
  it("defaults to no consent and disabled semantic search", async () => {
    const repository = new SemanticStateRepository(new MemoryStorage());
    await expect(repository.get()).resolves.toEqual(DEFAULT_SEMANTIC_STATE);
  });

  it("records explicit consent separately from model lifecycle progress", async () => {
    const storage = new MemoryStorage();
    const repository = new SemanticStateRepository(
      storage,
      () => new Date("2026-08-09T10:00:00.000Z"),
    );
    await repository.beginConsentInstall();
    await repository.markReady("wasm", 772);

    expect(storage.values[SEMANTIC_STATE_KEY]).toEqual({
      schemaVersion: 1,
      state: {
        enabled: true,
        consentGrantedAt: "2026-08-09T10:00:00.000Z",
        modelStatus: "ready",
        backend: "wasm",
        indexedBookmarks: 772,
        updatedAt: "2026-08-09T10:00:00.000Z",
        errorCode: null,
      },
    });
  });

  it("sanitizes corrupt data and removal revokes consent", async () => {
    const storage = new MemoryStorage();
    storage.values[SEMANTIC_STATE_KEY] = {
      schemaVersion: 1,
      state: { enabled: "yes", consentGrantedAt: "secret", modelStatus: "ready" },
    };
    const repository = new SemanticStateRepository(storage);
    await expect(repository.get()).resolves.toEqual(DEFAULT_SEMANTIC_STATE);
    await repository.beginConsentInstall();
    await repository.reset();
    await expect(repository.get()).resolves.toEqual(DEFAULT_SEMANTIC_STATE);
  });
});
