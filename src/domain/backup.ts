import {
  isSupportedLocale,
  type BookmarkRecord,
  type BookmarkTag,
  type FolderRecord,
  type SupportedLocale,
} from "./types";
import {
  normalizeStoredSettingsEnvelope,
  type StoredSettingsEnvelope,
} from "../settings/settings-repository";
import { emptyBookmarkMedia, isBookmarkMedia } from "./bookmark-media";

export const BACKUP_SCHEMA_VERSION = 2 as const;
const LEGACY_BACKUP_SCHEMA_VERSION = 1 as const;
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
export const MAX_BACKUP_BOOKMARKS = 100_000;
export const MAX_BACKUP_FOLDERS = 10_000;
export const MAX_BACKUP_TAGS = 20_000;

export interface BackupSettings {
  uiLocale: SupportedLocale | null;
  extension: StoredSettingsEnvelope;
}

export interface BookmarkXBackup {
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  data: {
    bookmarks: BookmarkRecord[];
    folders: FolderRecord[];
    tags: BookmarkTag[];
    archive: { lastSuccessfulSyncAt: string | null };
    settings: BackupSettings;
  };
}

export class BackupValidationError extends Error {
  constructor(message = "The selected file is not a valid Bookmark X backup.") {
    super(message);
    this.name = "BackupValidationError";
  }
}

function fail(field?: string): never {
  throw new BackupValidationError(
    field ? `The selected backup contains an invalid ${field}.` : undefined,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(
  value: unknown,
  keys: readonly string[],
  field: string,
): Record<string, unknown> {
  if (!isRecord(value)) fail(field);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(field);
  }
  return value;
}

function safeString(
  value: unknown,
  field: string,
  maxLength: number,
  options: { allowEmpty?: boolean; pattern?: RegExp } = {},
): string {
  if (
    typeof value !== "string" ||
    value.length > maxLength ||
    (!options.allowEmpty && value.length === 0) ||
    (options.pattern !== undefined && !options.pattern.test(value))
  ) {
    fail(field);
  }
  return value;
}

function canonicalDate(value: unknown, field: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string") fail(field);
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== value) fail(field);
  return value;
}

function optionalCanonicalDate(value: unknown, field: string): string {
  if (value === "") return "";
  return canonicalDate(value, field)!;
}

function localId(value: unknown, field: string): string {
  return safeString(value, field, 128, { pattern: /^[A-Za-z0-9_-]+$/ });
}

function normalizeTagName(value: string): string {
  return value
    .trim()
    .normalize("NFKC")
    .toLocaleUpperCase("und")
    .toLocaleLowerCase("und");
}

function parseAuthor(value: unknown): BookmarkRecord["author"] {
  const author = record(value, ["id", "username", "name"], "bookmark author");
  return {
    id: safeString(author.id, "bookmark author ID", 128, {
      pattern: /^[A-Za-z0-9_-]+$/,
    }),
    username: safeString(author.username, "bookmark username", 64, {
      pattern: /^[A-Za-z0-9_]+$/,
    }),
    name: safeString(author.name, "bookmark author name", 500, {
      allowEmpty: true,
    }),
  };
}

function parseStatusUrl(value: unknown, bookmarkId: string): string {
  const urlValue = safeString(value, "bookmark URL", 2_048);
  try {
    const url = new URL(urlValue);
    const match = url.pathname.match(/^\/[A-Za-z0-9_]+\/status\/(\d+)$/);
    if (
      url.protocol !== "https:" ||
      (url.hostname !== "x.com" && url.hostname !== "www.x.com") ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      match?.[1] !== bookmarkId
    ) {
      fail("bookmark URL");
    }
  } catch (error) {
    if (error instanceof BackupValidationError) throw error;
    fail("bookmark URL");
  }
  return urlValue;
}

function parseBookmark(
  value: unknown,
  schemaVersion: typeof BACKUP_SCHEMA_VERSION | typeof LEGACY_BACKUP_SCHEMA_VERSION,
): BookmarkRecord {
  const item = record(
    value,
    [
      "id",
      "text",
      "url",
      "author",
      "postCreatedAt",
      ...(schemaVersion === BACKUP_SCHEMA_VERSION ? ["media"] : []),
      "note",
      "folderId",
      "tagIds",
      "firstSavedAt",
      "lastSeenAt",
      "archivedAt",
      "metadataUpdatedAt",
      "status",
    ],
    "bookmark record",
  );
  const id = safeString(item.id, "bookmark ID", 32, { pattern: /^\d+$/ });
  if (!Array.isArray(item.tagIds) || item.tagIds.length > MAX_BACKUP_TAGS) {
    fail("bookmark tag references");
  }
  const tagIds = item.tagIds.map((tagId) => localId(tagId, "bookmark tag ID"));
  if (new Set(tagIds).size !== tagIds.length) fail("duplicate bookmark tag");
  if (item.folderId !== null && typeof item.folderId !== "string") {
    fail("bookmark folder ID");
  }
  const folderId =
    item.folderId === null ? null : localId(item.folderId, "bookmark folder ID");
  if (item.status !== "current" && item.status !== "archived") {
    fail("bookmark status");
  }
  const archivedAt = canonicalDate(item.archivedAt, "bookmark archive date", true);
  if (
    (item.status === "current" && archivedAt !== null) ||
    (item.status === "archived" && archivedAt === null)
  ) {
    fail("bookmark archive state");
  }
  const url = parseStatusUrl(item.url, id);
  const media =
    schemaVersion === LEGACY_BACKUP_SCHEMA_VERSION
      ? emptyBookmarkMedia()
      : isBookmarkMedia(item.media, url)
        ? structuredClone(item.media)
        : fail("bookmark media");
  const bookmark: BookmarkRecord = {
    id,
    text: safeString(item.text, "bookmark text", 1_000_000, { allowEmpty: true }),
    url,
    author: parseAuthor(item.author),
    // The X timeline can omit <time> for some media-only cards. Preserve that
    // established empty-string sentinel; every present timestamp stays strict.
    postCreatedAt: optionalCanonicalDate(item.postCreatedAt, "bookmark post date"),
    media,
    note: safeString(item.note, "bookmark note", 20_000, { allowEmpty: true }),
    folderId,
    tagIds,
    firstSavedAt: canonicalDate(item.firstSavedAt, "bookmark first-saved date")!,
    lastSeenAt: canonicalDate(item.lastSeenAt, "bookmark last-seen date")!,
    archivedAt,
    metadataUpdatedAt: canonicalDate(item.metadataUpdatedAt, "bookmark metadata date")!,
    status: item.status,
  };
  if (
    (bookmark.postCreatedAt !== "" && bookmark.postCreatedAt > bookmark.firstSavedAt) ||
    bookmark.lastSeenAt < bookmark.firstSavedAt ||
    bookmark.metadataUpdatedAt < bookmark.firstSavedAt ||
    (bookmark.archivedAt !== null && bookmark.archivedAt < bookmark.firstSavedAt)
  ) {
    fail("bookmark timestamp order");
  }
  return bookmark;
}

function parseFolder(value: unknown): FolderRecord {
  const item = record(value, ["id", "name", "parentId"], "folder record");
  const name = safeString(item.name, "folder name", 100);
  const hasControlCharacters = Array.from(name).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (name.trim() !== name || hasControlCharacters) {
    fail("folder name");
  }
  return {
    id: localId(item.id, "folder ID"),
    name,
    parentId:
      item.parentId === null ? null : localId(item.parentId, "parent folder ID"),
  };
}

function parseTag(value: unknown): BookmarkTag {
  const item = record(value, ["id", "name", "normalizedName"], "tag record");
  const name = safeString(item.name, "tag name", 50);
  const normalizedName = safeString(item.normalizedName, "normalized tag name", 50);
  if (
    name.trim().normalize("NFKC") !== name ||
    normalizeTagName(name) !== normalizedName
  ) {
    fail("normalized tag name");
  }
  return { id: localId(item.id, "tag ID"), name, normalizedName };
}

function assertUnique<T>(
  items: readonly T[],
  id: (item: T) => string,
  field: string,
): void {
  const ids = new Set<string>();
  for (const item of items) {
    const value = id(item);
    if (ids.has(value)) fail(field);
    ids.add(value);
  }
}

function assertFolderGraph(folders: readonly FolderRecord[]): void {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const siblingNames = new Set<string>();
  for (const folder of folders) {
    const siblingKey = `${folder.parentId ?? ""}\u0000${folder.name
      .normalize("NFKC")
      .toLocaleLowerCase("und")}`;
    if (siblingNames.has(siblingKey)) fail("duplicate sibling folder");
    siblingNames.add(siblingKey);
    if (folder.parentId !== null && !byId.has(folder.parentId)) {
      fail("orphan folder");
    }
    const visited = new Set<string>();
    let cursor: FolderRecord | undefined = folder;
    while (cursor !== undefined) {
      if (visited.has(cursor.id)) fail("folder cycle");
      visited.add(cursor.id);
      cursor = cursor.parentId === null ? undefined : byId.get(cursor.parentId);
    }
  }
}

function validateBackupValue(value: unknown, allowLegacy: boolean): BookmarkXBackup {
  const root = record(value, ["schemaVersion", "exportedAt", "data"], "backup file");
  const schemaVersion = root.schemaVersion;
  if (
    schemaVersion !== BACKUP_SCHEMA_VERSION &&
    !(allowLegacy && schemaVersion === LEGACY_BACKUP_SCHEMA_VERSION)
  ) {
    fail("backup schema version");
  }
  const data = record(
    root.data,
    ["bookmarks", "folders", "tags", "archive", "settings"],
    "backup data",
  );
  if (
    !Array.isArray(data.bookmarks) ||
    data.bookmarks.length > MAX_BACKUP_BOOKMARKS ||
    !Array.isArray(data.folders) ||
    data.folders.length > MAX_BACKUP_FOLDERS ||
    !Array.isArray(data.tags) ||
    data.tags.length > MAX_BACKUP_TAGS
  ) {
    fail("backup collection size");
  }
  const bookmarks = data.bookmarks.map((bookmark) =>
    parseBookmark(bookmark, schemaVersion),
  );
  const folders = data.folders.map(parseFolder);
  const tags = data.tags.map(parseTag);
  assertUnique(bookmarks, ({ id }) => id, "duplicate bookmark ID");
  assertUnique(folders, ({ id }) => id, "duplicate folder ID");
  assertUnique(tags, ({ id }) => id, "duplicate tag ID");
  assertUnique(tags, ({ normalizedName }) => normalizedName, "duplicate tag name");
  assertFolderGraph(folders);

  const folderIds = new Set(folders.map(({ id }) => id));
  const tagIds = new Set(tags.map(({ id }) => id));
  for (const bookmark of bookmarks) {
    if (bookmark.folderId !== null && !folderIds.has(bookmark.folderId)) {
      fail("bookmark folder reference");
    }
    if (bookmark.tagIds.some((id) => !tagIds.has(id))) {
      fail("bookmark tag reference");
    }
  }

  const archive = record(data.archive, ["lastSuccessfulSyncAt"], "archive metadata");
  const settings = record(data.settings, ["uiLocale", "extension"], "settings");
  if (settings.uiLocale !== null && !isSupportedLocale(settings.uiLocale)) {
    fail("interface locale");
  }
  const extensionSettings = normalizeStoredSettingsEnvelope(settings.extension);
  if (!extensionSettings) {
    fail("extension settings");
  }
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: canonicalDate(root.exportedAt, "export date")!,
    data: {
      bookmarks,
      folders,
      tags,
      archive: {
        lastSuccessfulSyncAt: canonicalDate(
          archive.lastSuccessfulSyncAt,
          "last successful sync date",
          true,
        ),
      },
      settings: {
        uiLocale: settings.uiLocale,
        extension: structuredClone(extensionSettings),
      },
    },
  };
}

export function validateBackup(value: unknown): BookmarkXBackup {
  return validateBackupValue(value, false);
}

export function parseBackup(content: string): BookmarkXBackup {
  if (new TextEncoder().encode(content).byteLength > MAX_BACKUP_BYTES) {
    throw new BackupValidationError("The selected backup is too large.");
  }
  try {
    return validateBackupValue(JSON.parse(content) as unknown, true);
  } catch (error) {
    if (error instanceof BackupValidationError) throw error;
    throw new BackupValidationError();
  }
}

export function serializeBackup(backup: BookmarkXBackup): string {
  const validated = validateBackup(backup);
  return `${JSON.stringify(validated, null, 2)}\n`;
}
