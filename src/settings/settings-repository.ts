import type { StorageArea } from "../storage/extension-state";

export const SETTINGS_STORAGE_KEY = "settings";
export const SETTINGS_SCHEMA_VERSION = 1 as const;

export type LibrarySurface = "modal" | "sidePanel";

export interface ExtensionSettings {
  appearance: {
    largeText: boolean;
    highContrast: boolean;
    reduceMotion: boolean;
  };
  behavior: {
    surface: LibrarySurface;
    promptAfterBookmark: boolean;
    metadata: {
      summary: boolean;
      breadcrumb: boolean;
      tags: boolean;
      note: boolean;
      categoryIndicator: boolean;
    };
  };
  export: {
    includeLink: boolean;
    includeText: boolean;
    includeAuthor: boolean;
    includeDate: boolean;
    includeImages: boolean;
    includeVideos: boolean;
    includeNote: boolean;
    includeTags: boolean;
    includeFolder: boolean;
  };
  search: {
    filterAsYouType: boolean;
  };
  data: {
    keepArchived: boolean;
  };
}

export interface StoredSettingsEnvelope {
  schemaVersion: typeof SETTINGS_SCHEMA_VERSION;
  settings: ExtensionSettings;
}

type DeepPartial<T> = {
  [Key in keyof T]?: T[Key] extends object ? DeepPartial<T[Key]> : T[Key];
};

export type SettingsPatch = DeepPartial<ExtensionSettings>;

export const DEFAULT_SETTINGS: Readonly<ExtensionSettings> = Object.freeze({
  appearance: Object.freeze({
    largeText: true,
    highContrast: true,
    reduceMotion: false,
  }),
  behavior: Object.freeze({
    surface: "modal",
    promptAfterBookmark: true,
    metadata: Object.freeze({
      summary: true,
      breadcrumb: true,
      tags: true,
      note: true,
      categoryIndicator: true,
    }),
  }),
  export: Object.freeze({
    includeLink: true,
    includeText: true,
    includeAuthor: true,
    includeDate: true,
    includeImages: true,
    includeVideos: true,
    includeNote: true,
    includeTags: true,
    includeFolder: true,
  }),
  search: Object.freeze({ filterAsYouType: true }),
  data: Object.freeze({ keepArchived: true }),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactly(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isExactBooleanRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, boolean> {
  return (
    isRecord(value) &&
    hasExactly(value, keys) &&
    Object.values(value).every((entry) => typeof entry === "boolean")
  );
}

/** Strict import-boundary guard for a complete canonical settings envelope. */
export function isStoredSettingsEnvelope(
  value: unknown,
): value is StoredSettingsEnvelope {
  if (
    !isRecord(value) ||
    !hasExactly(value, ["schemaVersion", "settings"]) ||
    value.schemaVersion !== SETTINGS_SCHEMA_VERSION ||
    !isRecord(value.settings) ||
    !hasExactly(value.settings, ["appearance", "behavior", "export", "search", "data"])
  ) {
    return false;
  }
  const settings = value.settings;
  if (
    !isExactBooleanRecord(settings.appearance, [
      "largeText",
      "highContrast",
      "reduceMotion",
    ]) ||
    !isRecord(settings.behavior) ||
    !hasExactly(settings.behavior, ["surface", "promptAfterBookmark", "metadata"]) ||
    (settings.behavior.surface !== "modal" &&
      settings.behavior.surface !== "sidePanel") ||
    typeof settings.behavior.promptAfterBookmark !== "boolean" ||
    !isExactBooleanRecord(settings.behavior.metadata, [
      "summary",
      "breadcrumb",
      "tags",
      "note",
      "categoryIndicator",
    ]) ||
    !isExactBooleanRecord(settings.export, [
      "includeLink",
      "includeText",
      "includeAuthor",
      "includeDate",
      "includeImages",
      "includeVideos",
      "includeNote",
      "includeTags",
      "includeFolder",
    ]) ||
    !isExactBooleanRecord(settings.search, ["filterAsYouType"]) ||
    !isExactBooleanRecord(settings.data, ["keepArchived"])
  ) {
    return false;
  }
  return true;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function sanitizeSettings(
  value: unknown,
  fallback: ExtensionSettings = DEFAULT_SETTINGS,
): ExtensionSettings {
  const root = isRecord(value) ? value : {};
  const appearance = isRecord(root.appearance) ? root.appearance : {};
  const behavior = isRecord(root.behavior) ? root.behavior : {};
  const metadata = isRecord(behavior.metadata) ? behavior.metadata : {};
  const exportSettings = isRecord(root.export) ? root.export : {};
  const search = isRecord(root.search) ? root.search : {};
  const data = isRecord(root.data) ? root.data : {};

  return {
    appearance: {
      largeText: booleanOr(appearance.largeText, fallback.appearance.largeText),
      highContrast: booleanOr(
        appearance.highContrast,
        fallback.appearance.highContrast,
      ),
      reduceMotion: booleanOr(
        appearance.reduceMotion,
        fallback.appearance.reduceMotion,
      ),
    },
    behavior: {
      surface:
        behavior.surface === "modal" || behavior.surface === "sidePanel"
          ? behavior.surface
          : fallback.behavior.surface,
      promptAfterBookmark: booleanOr(
        behavior.promptAfterBookmark,
        fallback.behavior.promptAfterBookmark,
      ),
      metadata: {
        summary: booleanOr(metadata.summary, fallback.behavior.metadata.summary),
        breadcrumb: booleanOr(
          metadata.breadcrumb,
          fallback.behavior.metadata.breadcrumb,
        ),
        tags: booleanOr(metadata.tags, fallback.behavior.metadata.tags),
        note: booleanOr(metadata.note, fallback.behavior.metadata.note),
        categoryIndicator: booleanOr(
          metadata.categoryIndicator,
          fallback.behavior.metadata.categoryIndicator,
        ),
      },
    },
    export: {
      includeLink: booleanOr(exportSettings.includeLink, fallback.export.includeLink),
      includeText: booleanOr(exportSettings.includeText, fallback.export.includeText),
      includeAuthor: booleanOr(
        exportSettings.includeAuthor,
        fallback.export.includeAuthor,
      ),
      includeDate: booleanOr(exportSettings.includeDate, fallback.export.includeDate),
      includeImages: booleanOr(
        exportSettings.includeImages,
        fallback.export.includeImages,
      ),
      includeVideos: booleanOr(
        exportSettings.includeVideos,
        fallback.export.includeVideos,
      ),
      includeNote: booleanOr(exportSettings.includeNote, fallback.export.includeNote),
      includeTags: booleanOr(exportSettings.includeTags, fallback.export.includeTags),
      includeFolder: booleanOr(
        exportSettings.includeFolder,
        fallback.export.includeFolder,
      ),
    },
    search: {
      filterAsYouType: booleanOr(
        search.filterAsYouType,
        fallback.search.filterAsYouType,
      ),
    },
    data: {
      keepArchived: booleanOr(data.keepArchived, fallback.data.keepArchived),
    },
  };
}

export function isSettingsPatch(value: unknown): value is SettingsPatch {
  if (!isRecord(value)) return false;
  const hasOnly = (record: Record<string, unknown>, keys: string[]): boolean =>
    Object.keys(record).every((key) => keys.includes(key));
  const booleanPatch = (candidate: unknown, keys: string[]): boolean =>
    isRecord(candidate) &&
    hasOnly(candidate, keys) &&
    Object.values(candidate).every((entry) => typeof entry === "boolean");
  if (!hasOnly(value, ["appearance", "behavior", "export", "search", "data"])) {
    return false;
  }
  if (
    value.appearance !== undefined &&
    !booleanPatch(value.appearance, ["largeText", "highContrast", "reduceMotion"])
  ) {
    return false;
  }
  if (value.behavior !== undefined) {
    if (
      !isRecord(value.behavior) ||
      !hasOnly(value.behavior, ["surface", "promptAfterBookmark", "metadata"])
    ) {
      return false;
    }
    if (
      value.behavior.surface !== undefined &&
      value.behavior.surface !== "modal" &&
      value.behavior.surface !== "sidePanel"
    ) {
      return false;
    }
    if (
      value.behavior.promptAfterBookmark !== undefined &&
      typeof value.behavior.promptAfterBookmark !== "boolean"
    ) {
      return false;
    }
    if (
      value.behavior.metadata !== undefined &&
      !booleanPatch(value.behavior.metadata, [
        "summary",
        "breadcrumb",
        "tags",
        "note",
        "categoryIndicator",
      ])
    ) {
      return false;
    }
  }
  if (
    value.export !== undefined &&
    !booleanPatch(value.export, [
      "includeLink",
      "includeText",
      "includeAuthor",
      "includeDate",
      "includeImages",
      "includeVideos",
      "includeNote",
      "includeTags",
      "includeFolder",
    ])
  ) {
    return false;
  }
  if (value.search !== undefined && !booleanPatch(value.search, ["filterAsYouType"])) {
    return false;
  }
  return value.data === undefined || booleanPatch(value.data, ["keepArchived"]);
}

export class SettingsRepository {
  constructor(private readonly storage: Pick<StorageArea, "get" | "set">) {}

  async get(): Promise<ExtensionSettings> {
    const values = await this.storage.get(SETTINGS_STORAGE_KEY);
    const stored = values[SETTINGS_STORAGE_KEY];
    if (
      isRecord(stored) &&
      stored.schemaVersion === SETTINGS_SCHEMA_VERSION &&
      isRecord(stored.settings)
    ) {
      return sanitizeSettings(stored.settings);
    }
    // Pre-schema builds stored the settings object directly. Reading it here is the
    // only migration needed for schema v1; the next save writes the envelope.
    return sanitizeSettings(stored);
  }

  async save(patch: SettingsPatch): Promise<ExtensionSettings> {
    const current = await this.get();
    const settings = sanitizeSettings(patch, current);
    const stored: StoredSettingsEnvelope = {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      settings,
    };
    await this.storage.set({ [SETTINGS_STORAGE_KEY]: stored });
    return settings;
  }
}
