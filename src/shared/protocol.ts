import type {
  ArchiveStats,
  BookmarkSnapshot,
  ExportFormat,
  ScrapeRun,
  SupportedLocale,
} from "../domain/types";

export interface PopupStatus {
  pageReady: boolean;
  stats: ArchiveStats;
  scrape: ScrapeRun | null;
}

export type PopupRequest =
  | { type: "GET_STATUS" }
  | { type: "OPEN_BOOKMARKS" }
  | { type: "START_SCRAPE" }
  | { type: "CANCEL_SCRAPE" }
  | { type: "CLEAR_ARCHIVE" }
  | {
      type: "EXPORT_BOOKMARKS";
      payload: { format: ExportFormat; locale: SupportedLocale };
    };

export type ContentControlRequest =
  { type: "START_SCRAPE"; runId: string } | { type: "CANCEL_SCRAPE"; runId: string };

export type ContentEvent =
  | {
      type: "SCRAPE_BATCH";
      runId: string;
      bookmarks: BookmarkSnapshot[];
    }
  | { type: "SCRAPE_PROGRESS"; runId: string; fetched: number }
  | {
      type: "SCRAPE_COMPLETE";
      runId: string;
      status: "completed" | "cancelled";
      fetched: number;
    }
  | { type: "SCRAPE_FAILED"; runId: string; errorCode: string };

export interface ExportResult {
  content: string;
  filename: string;
}

export interface RuntimeError {
  code: string;
  message: string;
}

export type RuntimeResponse<T> =
  { ok: true; data: T } | { ok: false; error: RuntimeError };

export type SendMessage = <T>(request: PopupRequest) => Promise<RuntimeResponse<T>>;
