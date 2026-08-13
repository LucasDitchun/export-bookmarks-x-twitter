export interface BookmarkAuthor {
  id: string;
  username: string;
  name: string;
}

export interface BookmarkFolder {
  id: string;
  name: string;
}

export interface FolderRecord {
  id: string;
  name: string;
  parentId: string | null;
  deletedAt?: string;
}

export interface BookmarkFolderMembership {
  bookmarkId: string;
  folderId: string;
}

export interface BookmarkTag {
  id: string;
  name: string;
  normalizedName: string;
  deletedAt?: string;
}

export type BookmarkStatus = "current" | "archived";

export interface BookmarkVideoMedia {
  thumbnailUrl: string | null;
  /** Canonical X status URL. Direct MP4/CDN URLs are intentionally not stored. */
  postUrl: string;
}

export interface BookmarkMedia {
  images: string[];
  videos: BookmarkVideoMedia[];
}

export interface BookmarkRecord {
  id: string;
  text: string;
  url: string;
  author: BookmarkAuthor;
  postCreatedAt: string;
  media: BookmarkMedia;
  note: string;
  folderId: string | null;
  tagIds: string[];
  firstSavedAt: string;
  lastSeenAt: string;
  archivedAt: string | null;
  metadataUpdatedAt: string;
  status: BookmarkStatus;
}

/** Read model used by note, tag, and folder editors. */
export type BookmarkMetadataReadModel = Pick<
  BookmarkRecord,
  "id" | "note" | "folderId" | "tagIds"
>;

/** Read model rendered by the supplementary metadata card on X. */
export type BookmarkDecorationReadModel = BookmarkMetadataReadModel &
  Pick<BookmarkRecord, "text" | "url" | "status">;

/** Read model required by the popup folder assignment control. */
export type BookmarkFolderReadModel = Pick<BookmarkRecord, "id" | "folderId">;

export interface BookmarkMetadataTagSelection {
  id: string | null;
  name: string;
}

export interface BookmarkMetadataFolderSelection {
  id: string | null;
  path: string[];
  newSegments?: string[];
}

export interface SaveBookmarkMetadataInput {
  id: string;
  note: string;
  tags: BookmarkMetadataTagSelection[];
  folder: BookmarkMetadataFolderSelection | null;
  /** Omitted by older clients, which retain full-replacement semantics. */
  organizationChanges?: { tags: boolean; folder: boolean };
}

export interface HydratedBookmarkRecord extends BookmarkRecord {
  folders: BookmarkFolder[];
}

export type BookmarkSnapshot = Pick<
  BookmarkRecord,
  "id" | "text" | "url" | "author" | "postCreatedAt"
> & {
  /** Optional only for compatibility with an already-running older content script. */
  media?: BookmarkMedia;
};

export const SUPPORTED_LOCALES = [
  "en",
  "pt_BR",
  "ja",
  "es",
  "zh_CN",
  "de",
  "fr",
  "it",
] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

export interface ArchiveStats {
  total: number;
  current: number;
  archived: number;
  lastSuccessfulSyncAt: string | null;
}

export type ScrapeStatus = "idle" | "running" | "completed" | "cancelled" | "error";
export type ScrapeMode = "quick" | "full";
export type ScrapeCompletionReason = "checkpoint_stop" | "stable_end" | "full_fallback";

export interface ScrapeCheckpointState {
  ids: string[];
  updatedAt: string;
}

export interface ScrapeRun {
  id: string;
  tabId: number;
  status: ScrapeStatus;
  fetched: number;
  added: number;
  updated: number;
  startedAt: string;
  updatedAt: string;
  errorCode: string | null;
  mode: ScrapeMode;
  quickStopThreshold?: number;
  checkpointIds: string[];
  checkpointCandidates: string[];
  checkpointMatchIds: string[];
  completionReason: ScrapeCompletionReason | null;
}
