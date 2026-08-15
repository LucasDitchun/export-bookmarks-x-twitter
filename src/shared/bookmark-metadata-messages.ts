export const BOOKMARK_MODAL_MESSAGE_KEYS = [
  "bookmarkPromptTitle",
  "bookmarkPromptClose",
  "bookmarkPromptNote",
  "bookmarkPromptFolder",
  "bookmarkPromptPreferencesHint",
  "bookmarkPromptPreferencesOpen",
  "bookmarkPromptSave",
  "bookmarkPromptTags",
  "bookmarkPromptTagsHelp",
  "liveBookmarkPending",
  "liveBookmarkSaved",
  "liveBookmarkFailed",
  "liveBookmarkArchived",
] as const;

export const BOOKMARK_DECORATOR_MESSAGE_KEYS = [
  "bookmarkMetadataLabel",
  "bookmarkMetadataArchived",
  "liveBookmarkPending",
  "uncategorizedFolder",
  "bookmarkMetadataOrganize",
  "bookmarkPromptFolder",
  "bookmarkPromptTags",
  "bookmarkPromptNote",
] as const;

export type BookmarkMetadataMessageKey =
  | (typeof BOOKMARK_MODAL_MESSAGE_KEYS)[number]
  | (typeof BOOKMARK_DECORATOR_MESSAGE_KEYS)[number];

export const BOOKMARK_METADATA_MESSAGE_KEYS: readonly BookmarkMetadataMessageKey[] = [
  ...new Set<BookmarkMetadataMessageKey>([
    ...BOOKMARK_MODAL_MESSAGE_KEYS,
    ...BOOKMARK_DECORATOR_MESSAGE_KEYS,
  ]),
];

export type BookmarkMetadataMessages = Readonly<
  Partial<Record<BookmarkMetadataMessageKey, string>>
>;

export type BookmarkMetadataTranslator = (key: BookmarkMetadataMessageKey) => string;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function bookmarkMetadataMessagesFromCatalog(
  catalog: unknown,
): BookmarkMetadataMessages {
  if (!isRecord(catalog)) throw new Error("Invalid bookmark metadata catalog.");
  const messages = {} as Record<BookmarkMetadataMessageKey, string>;
  for (const key of BOOKMARK_METADATA_MESSAGE_KEYS) {
    const entry = catalog[key];
    if (
      !isRecord(entry) ||
      typeof entry.message !== "string" ||
      entry.message.trim().length === 0
    ) {
      throw new Error(`Missing bookmark metadata message: ${key}.`);
    }
    messages[key] = entry.message;
  }
  return messages;
}
