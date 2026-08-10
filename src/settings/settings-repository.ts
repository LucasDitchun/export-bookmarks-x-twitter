import type { StorageArea } from "../storage/extension-state";
import {
  DEFAULT_QUICK_STOP_THRESHOLD,
  isQuickStopThreshold,
  sanitizeQuickStopThreshold,
} from "../domain/quick-update";

export const SETTINGS_STORAGE_KEY = "settings";
export const SETTINGS_SCHEMA_VERSION = 2 as const;
const LEGACY_SETTINGS_SCHEMA_VERSION = 1 as const;

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
    includeFirstSavedAt: boolean;
    includeLastSeenAt: boolean;
  };
  search: {
    filterAsYouType: boolean;
  };
  data: {
    keepArchived: boolean;
    quickStopThreshold: number;
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
    includeFirstSavedAt: true,
    includeLastSeenAt: true,
  }),
  search: Object.freeze({ filterAsYouType: true }),
  data: Object.freeze({
    keepArchived: true,
    quickStopThreshold: DEFAULT_QUICK_STOP_THRESHOLD,
  }),
});

export function hasEnabledExportSetting(
  settings: ExtensionSettings["export"],
): boolean {
  return Object.values(settings).some(Boolean);
}

function ensureEnabledExportSetting(settings: ExtensionSettings): ExtensionSettings {
  return hasEnabledExportSetting(settings.export)
    ? settings
    : { ...settings, export: { ...settings.export, includeLink: true } };
}

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
function isCanonicalSettings(value: unknown): value is ExtensionSettings {
  if (
    !isRecord(value) ||
    !hasExactly(value, ["appearance", "behavior", "export", "search", "data"])
  ) {
    return false;
  }
  const settings = value;
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
      "includeFirstSavedAt",
      "includeLastSeenAt",
    ]) ||
    !isExactBooleanRecord(settings.search, ["filterAsYouType"]) ||
    !isRecord(settings.data) ||
    !hasExactly(settings.data, ["keepArchived", "quickStopThreshold"]) ||
    typeof settings.data.keepArchived !== "boolean" ||
    !isQuickStopThreshold(settings.data.quickStopThreshold)
  ) {
    return false;
  }
  return hasEnabledExportSetting(settings.export as ExtensionSettings["export"]);
}

function isLegacySettings(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasExactly(value, ["appearance", "behavior", "export", "search", "data"]) &&
    isCanonicalSettings({
      ...value,
      data: isRecord(value.data)
        ? {
            ...value.data,
            quickStopThreshold: DEFAULT_QUICK_STOP_THRESHOLD,
          }
        : value.data,
    }) &&
    isExactBooleanRecord(value.data, ["keepArchived"])
  );
}

export function normalizeStoredSettingsEnvelope(
  value: unknown,
): StoredSettingsEnvelope | null {
  if (
    !isRecord(value) ||
    !hasExactly(value, ["schemaVersion", "settings"]) ||
    !isRecord(value.settings)
  ) {
    return null;
  }
  if (
    value.schemaVersion === SETTINGS_SCHEMA_VERSION &&
    isCanonicalSettings(value.settings)
  ) {
    return value as unknown as StoredSettingsEnvelope;
  }
  if (
    value.schemaVersion === LEGACY_SETTINGS_SCHEMA_VERSION &&
    isLegacySettings(value.settings)
  ) {
    return {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      settings: sanitizeSettings(value.settings),
    };
  }
  return null;
}

/** Strict import-boundary guard for a complete canonical settings envelope. */
export function isStoredSettingsEnvelope(
  value: unknown,
): value is StoredSettingsEnvelope {
  return (
    isRecord(value) &&
    hasExactly(value, ["schemaVersion", "settings"]) &&
    value.schemaVersion === SETTINGS_SCHEMA_VERSION &&
    isCanonicalSettings(value.settings)
  );
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
      includeFirstSavedAt: booleanOr(
        exportSettings.includeFirstSavedAt,
        fallback.export.includeFirstSavedAt,
      ),
      includeLastSeenAt: booleanOr(
        exportSettings.includeLastSeenAt,
        fallback.export.includeLastSeenAt,
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
      quickStopThreshold: sanitizeQuickStopThreshold(
        data.quickStopThreshold,
        fallback.data.quickStopThreshold,
      ),
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
      "includeFirstSavedAt",
      "includeLastSeenAt",
    ])
  ) {
    return false;
  }
  if (value.search !== undefined && !booleanPatch(value.search, ["filterAsYouType"])) {
    return false;
  }
  if (value.data === undefined) return true;
  if (
    !isRecord(value.data) ||
    !hasOnly(value.data, ["keepArchived", "quickStopThreshold"])
  ) {
    return false;
  }
  return (
    (value.data.keepArchived === undefined ||
      typeof value.data.keepArchived === "boolean") &&
    (value.data.quickStopThreshold === undefined ||
      isQuickStopThreshold(value.data.quickStopThreshold))
  );
}

export class SettingsRepository {
  constructor(private readonly storage: Pick<StorageArea, "get" | "set">) {}

  async get(): Promise<ExtensionSettings> {
    const values = await this.storage.get(SETTINGS_STORAGE_KEY);
    const stored = values[SETTINGS_STORAGE_KEY];
    const normalized = normalizeStoredSettingsEnvelope(stored);
    if (normalized) return ensureEnabledExportSetting(normalized.settings);
    const recoverableSettings =
      isRecord(stored) && isRecord(stored.settings) ? stored.settings : stored;
    // Pre-schema builds stored the settings object directly. Reading it here is the
    // only migration needed for schema v1; the next save writes the envelope.
    return ensureEnabledExportSetting(sanitizeSettings(recoverableSettings));
  }

  async save(patch: SettingsPatch): Promise<ExtensionSettings> {
    const current = await this.get();
    const settings = sanitizeSettings(patch, current);
    if (!hasEnabledExportSetting(settings.export)) {
      throw new RangeError("Select at least one field to export.");
    }
    const stored: StoredSettingsEnvelope = {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      settings,
    };
    await this.storage.set({ [SETTINGS_STORAGE_KEY]: stored });
    return settings;
  }
}
