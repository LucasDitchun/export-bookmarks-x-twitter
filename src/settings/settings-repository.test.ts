import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION,
  SETTINGS_STORAGE_KEY,
  SettingsRepository,
  isStoredSettingsEnvelope,
} from "./settings-repository";

class MemoryStorageArea {
  readonly values: Record<string, unknown> = {};

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
}

describe("SettingsRepository", () => {
  it("returns accessibility-forward defaults when storage is empty", async () => {
    const repository = new SettingsRepository(new MemoryStorageArea());

    await expect(repository.get()).resolves.toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.behavior.surface).toBe("modal");
    expect(DEFAULT_SETTINGS.behavior.promptAfterBookmark).toBe(true);
    expect(Object.values(DEFAULT_SETTINGS.behavior.metadata)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("merges valid stored values without trusting malformed or unknown data", async () => {
    const storage = new MemoryStorageArea();
    storage.values[SETTINGS_STORAGE_KEY] = {
      appearance: { largeText: false, highContrast: "yes" },
      behavior: {
        surface: "sidePanel",
        promptAfterBookmark: false,
        metadata: { note: false, tags: "no", unknown: false },
      },
      export: { includeImages: false, includeStatus: true },
      unknown: { accepted: true },
    };

    const settings = await new SettingsRepository(storage).get();

    expect(settings.appearance).toEqual({
      largeText: false,
      highContrast: true,
      reduceMotion: false,
    });
    expect(settings.behavior.surface).toBe("sidePanel");
    expect(settings.behavior.promptAfterBookmark).toBe(false);
    expect(settings.behavior.metadata.note).toBe(false);
    expect(settings.behavior.metadata.tags).toBe(true);
    expect(settings.export.includeImages).toBe(false);
    expect(settings).not.toHaveProperty("unknown");
    expect(settings.export).not.toHaveProperty("includeStatus");
  });

  it("persists one canonical serializable settings object", async () => {
    const storage = new MemoryStorageArea();
    const repository = new SettingsRepository(storage);
    const updated = {
      ...DEFAULT_SETTINGS,
      behavior: { ...DEFAULT_SETTINGS.behavior, surface: "sidePanel" as const },
    };

    await expect(repository.save(updated)).resolves.toEqual(updated);
    expect(storage.values).toEqual({
      [SETTINGS_STORAGE_KEY]: {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        settings: updated,
      },
    });
    expect(JSON.parse(JSON.stringify(storage.values))).toEqual(storage.values);
  });

  it("strictly validates complete versioned envelopes at import boundaries", () => {
    const valid = {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      settings: structuredClone(DEFAULT_SETTINGS),
    };

    expect(isStoredSettingsEnvelope(valid)).toBe(true);
    for (const invalid of [
      { ...valid, extra: true },
      { ...valid, schemaVersion: 2 },
      {
        ...valid,
        settings: { ...valid.settings, unknown: true },
      },
      {
        ...valid,
        settings: {
          ...valid.settings,
          behavior: {
            ...valid.settings.behavior,
            metadata: { ...valid.settings.behavior.metadata, note: "yes" },
          },
        },
      },
      {
        ...valid,
        settings: {
          ...valid.settings,
          export: { ...valid.settings.export, includeVideos: undefined },
        },
      },
    ]) {
      expect(isStoredSettingsEnvelope(invalid)).toBe(false);
    }
  });
});
