import type {
  ArchiveStats,
  BookmarkRecord,
  BookmarkSnapshot,
  BookmarkTag,
  FolderRecord,
  ScrapeMode,
  ScrapeRun,
  SupportedLocale,
} from "../domain/types";
import type { BookmarkExportFormat } from "../domain/export-bookmarks";
import type {
  ExtensionSettings,
  LibrarySurface,
  SettingsPatch,
} from "../settings/settings-repository";
import type { SemanticSourceDocument } from "../domain/semantic-search";

export interface PopupStatus {
  pageReady: boolean;
  stats: ArchiveStats;
  scrape: ScrapeRun | null;
  fullReviewDue: boolean;
  quickUpdateAvailable: boolean;
}

export type BookmarkView = "current" | "inbox" | "archived";

export type NotedBookmark = BookmarkRecord & { note: string };

export interface BookmarkListPage {
  items: NotedBookmark[];
  nextCursor: string | null;
}

export interface BookmarkSearchPage extends BookmarkListPage {
  total: number;
}

export interface SemanticCorpusResult {
  documents: SemanticSourceDocument[];
}

export interface BookmarkDetailResult {
  bookmark: NotedBookmark | null;
}

export interface BookmarkDecorationItem {
  bookmark: BookmarkRecord;
  breadcrumb: string[];
  tags: BookmarkTag[];
}

export interface BookmarkDecorationLookupResult {
  items: BookmarkDecorationItem[];
  locale: SupportedLocale;
  messages: Record<string, string>;
  settings: ExtensionSettings;
}

export interface BookmarkLocalizationResult {
  locale: SupportedLocale;
  messages: Record<string, string>;
}

export interface TagListResult {
  tags: BookmarkTag[];
  usage?: Record<string, number>;
}

export interface TagAssignmentResult {
  bookmark: NotedBookmark;
  tag: BookmarkTag;
}

export interface TagDetailResult {
  tag: BookmarkTag;
}

export interface TagRemovalResult {
  bookmark: NotedBookmark;
}

export interface TagDeleteResult {
  deletedTagId: string;
  preservedBookmarkCount: number;
}

export interface FolderListResult {
  folders: FolderRecord[];
  usage?: Record<string, number>;
}

export interface FolderDetailResult {
  folder: FolderRecord;
}

export interface FolderDeleteResult {
  deletedFolderIds: string[];
  preservedBookmarkCount: number;
}

export interface OrganizationTrashResult {
  tags: BookmarkTag[];
  folders: FolderRecord[];
}

export interface FolderRestoreResult {
  restoredFolderIds: string[];
  restoredBookmarkCount: number;
}

export interface SettingsResult {
  settings: ExtensionSettings;
}

export interface OpenSurfaceResult {
  surface: LibrarySurface;
  opened: boolean;
}

export interface JsonBackupExportResult {
  content: string;
  filename: string;
}

export interface JsonBackupRestoreResult {
  bookmarks: number;
  folders: number;
  tags: number;
  mode: "merge" | "replace";
  reloadRequired: true;
}

export type LiveBookmarkAction = "save" | "remove";
export type LiveBookmarkState = "pending" | "saved" | "archived" | "cancelled";

export interface LiveBookmarkContext {
  intentId: string;
  action: LiveBookmarkAction;
  state: LiveBookmarkState;
  bookmark: BookmarkSnapshot;
  updatedAt: string;
}

export interface LiveBookmarkIntentResult extends OpenSurfaceResult {
  prompt: boolean;
  localization?: BookmarkLocalizationResult;
}

export type UiRequest =
  | { type: "GET_STATUS" }
  | { type: "GET_SETTINGS" }
  | { type: "GET_SEMANTIC_CORPUS" }
  | { type: "SAVE_SETTINGS"; payload: { settings: SettingsPatch } }
  | { type: "OPEN_SELECTED_SURFACE" }
  | { type: "OPEN_BOOKMARKS" }
  | { type: "START_SCRAPE"; payload?: { mode: ScrapeMode } }
  | { type: "CANCEL_SCRAPE" }
  | { type: "CLEAR_ARCHIVE" }
  | { type: "EXPORT_BACKUP" }
  | {
      type: "RESTORE_BACKUP";
      payload:
        | { content: string; mode: "merge"; confirmed?: false }
        | { content: string; mode: "replace"; confirmed: true };
    }
  | {
      type: "EXPORT_BOOKMARKS";
      payload: {
        format: BookmarkExportFormat;
        locale: SupportedLocale;
        folderId: string | null;
        tagIds: string[];
        includeArchived: boolean;
      };
    }
  | {
      type: "LIST_BOOKMARKS";
      payload?: { view?: BookmarkView; cursor?: string; limit?: number };
    }
  | {
      type: "SEARCH_BOOKMARKS";
      payload: {
        query: string;
        view: BookmarkView;
        cursor?: string;
        limit?: number;
      };
    }
  | { type: "GET_BOOKMARK"; payload: { id: string } }
  | { type: "GET_BOOKMARK_DECORATIONS"; payload: { ids: string[] } }
  | { type: "SAVE_BOOKMARK_NOTE"; payload: { id: string; note: string } }
  | {
      type: "SAVE_BOOKMARK_METADATA";
      payload: { id: string; note: string; tags: string[]; folderPath: string[] };
    }
  | { type: "LIST_TAGS" }
  | { type: "LIST_ORGANIZATION_TRASH" }
  | { type: "ADD_BOOKMARK_TAG"; payload: { id: string; name: string } }
  | { type: "RENAME_TAG"; payload: { id: string; name: string } }
  | { type: "DELETE_TAG"; payload: { id: string } }
  | { type: "RESTORE_TAG"; payload: { id: string } }
  | {
      type: "REMOVE_BOOKMARK_TAG";
      payload: { id: string; tagId: string };
    }
  | { type: "LIST_FOLDERS" }
  | {
      type: "CREATE_FOLDER";
      payload: { name: string; parentId: string | null };
    }
  | { type: "RENAME_FOLDER"; payload: { id: string; name: string } }
  | { type: "DELETE_FOLDER"; payload: { id: string } }
  | { type: "RESTORE_FOLDER"; payload: { id: string } }
  | {
      type: "ASSIGN_BOOKMARK_FOLDER";
      payload: { bookmarkId: string; folderId: string | null };
    };

/** @deprecated Use UiRequest. Kept as a source-compatible alias for popup callers. */
export type PopupRequest = UiRequest;

export type ContentControlRequest =
  | {
      type: "START_SCRAPE";
      runId: string;
      mode: ScrapeMode;
      quickStopThreshold: number;
      checkpointIds: string[];
    }
  | { type: "CANCEL_SCRAPE"; runId: string }
  | {
      type: "REFRESH_BOOKMARK_METADATA";
      bookmarkIds?: string[];
    }
  | {
      type: "REFRESH_BOOKMARK_LOCALIZATION";
      localization: BookmarkLocalizationResult;
    };

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
      status: "completed";
      fetched: number;
      completionReason: "stable_end" | "checkpoint_stop";
    }
  | {
      type: "SCRAPE_COMPLETE";
      runId: string;
      status: "cancelled";
      fetched: number;
    }
  | { type: "SCRAPE_FAILED"; runId: string; errorCode: string }
  | {
      type: "LIVE_BOOKMARK_PENDING";
      intentId: string;
      action: LiveBookmarkAction;
      bookmark: BookmarkSnapshot;
    }
  | {
      type: "LIVE_BOOKMARK_CONFIRMED";
      intentId: string;
      action: LiveBookmarkAction;
      bookmark: BookmarkSnapshot;
    }
  | { type: "LIVE_BOOKMARK_CANCELLED"; intentId: string };

export type LiveBookmarkEvent = Extract<
  ContentEvent,
  | { type: "LIVE_BOOKMARK_PENDING" }
  | { type: "LIVE_BOOKMARK_CONFIRMED" }
  | { type: "LIVE_BOOKMARK_CANCELLED" }
>;

export interface ExportResult {
  content: string;
  filename: string;
}

export interface RuntimeError {
  code: string;
  message: string;
  recovery?: {
    dataRestored: true;
    reloadRequired: true;
  };
}

export type RuntimeResponse<T> =
  { ok: true; data: T } | { ok: false; error: RuntimeError };

export type SendMessage = <T>(request: UiRequest) => Promise<RuntimeResponse<T>>;
