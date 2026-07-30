export interface BookmarkAuthor {
  id: string;
  username: string;
  name: string;
}

export interface BookmarkFolder {
  id: string;
  name: string;
}

export interface BookmarkRecord {
  id: string;
  text: string;
  url: string;
  author: BookmarkAuthor;
  postCreatedAt: string;
  folders: BookmarkFolder[];
  firstArchivedAt: string;
  lastSeenAt: string;
  isCurrent: boolean;
}

export type BookmarkSnapshot = Pick<
  BookmarkRecord,
  "id" | "text" | "url" | "author" | "postCreatedAt"
>;

export type ExportFormat = "full" | "urls";
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

export interface ExportOptions {
  format: ExportFormat;
  locale: SupportedLocale;
}

export interface ArchiveStats {
  total: number;
  current: number;
  archived: number;
  lastSuccessfulSyncAt: string | null;
}

export type ScrapeStatus = "idle" | "running" | "completed" | "cancelled" | "error";

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
}
