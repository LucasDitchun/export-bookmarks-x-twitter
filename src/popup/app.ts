import type {
  ArchiveStats,
  ExportFormat,
  ScrapeRun,
  SupportedLocale,
} from "../domain/types";
import { getLocaleTag, type Translator } from "./i18n";
import type {
  ExportResult,
  PopupRequest,
  PopupStatus,
  RuntimeError,
  SendMessage,
} from "./protocol";

interface PopupAppOptions {
  document: Document;
  locale: SupportedLocale;
  sendMessage: SendMessage;
  translate: Translator;
  createDownload?: (result: ExportResult) => void;
  schedule?: typeof window.setTimeout;
  cancelSchedule?: typeof window.clearTimeout;
}

interface RequiredElements {
  alert: HTMLElement;
  archivedCount: HTMLElement;
  captureButton: HTMLButtonElement;
  captureButtonLabel: HTMLElement;
  captureFeedback: HTMLElement;
  captureProgress: HTMLElement;
  captureProgressCopy: HTMLElement;
  captureState: HTMLElement;
  clearDialog: HTMLDialogElement;
  confirmClearButton: HTMLButtonElement;
  currentCount: HTMLElement;
  dashboardView: HTMLElement;
  duplicateSummary: HTMLElement;
  emptyNote: HTMLElement;
  exportFullButton: HTMLButtonElement;
  exportUrlsButton: HTMLButtonElement;
  lastSync: HTMLElement;
  loadingView: HTMLElement;
  openBookmarksButton: HTMLButtonElement;
  openClearDialogButton: HTMLButtonElement;
  pageBadge: HTMLElement;
  pageGuidance: HTMLElement;
  pageLabel: HTMLElement;
  totalCount: HTMLElement;
}

const EMPTY_STATS: ArchiveStats = {
  total: 0,
  current: 0,
  archived: 0,
  lastSuccessfulSyncAt: null,
};

function requireElement<T extends HTMLElement>(document: Document, id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing popup element: #${id}`);
  return element as T;
}

function getElements(document: Document): RequiredElements {
  return {
    alert: requireElement(document, "alert"),
    archivedCount: requireElement(document, "archived-count"),
    captureButton: requireElement(document, "capture-button"),
    captureButtonLabel: requireElement(document, "capture-button-label"),
    captureFeedback: requireElement(document, "capture-feedback"),
    captureProgress: requireElement(document, "capture-progress"),
    captureProgressCopy: requireElement(document, "capture-progress-copy"),
    captureState: requireElement(document, "capture-state"),
    clearDialog: requireElement(document, "clear-dialog"),
    confirmClearButton: requireElement(document, "confirm-clear-button"),
    currentCount: requireElement(document, "current-count"),
    dashboardView: requireElement(document, "dashboard-view"),
    duplicateSummary: requireElement(document, "duplicate-summary"),
    emptyNote: requireElement(document, "empty-note"),
    exportFullButton: requireElement(document, "export-full-button"),
    exportUrlsButton: requireElement(document, "export-urls-button"),
    lastSync: requireElement(document, "last-sync"),
    loadingView: requireElement(document, "loading-view"),
    openBookmarksButton: requireElement(document, "open-bookmarks-button"),
    openClearDialogButton: requireElement(document, "open-clear-dialog-button"),
    pageBadge: requireElement(document, "page-badge"),
    pageGuidance: requireElement(document, "page-guidance"),
    pageLabel: requireElement(document, "page-label"),
    totalCount: requireElement(document, "total-count"),
  };
}

function defaultDownload(result: ExportResult): void {
  const blob = new Blob([result.content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function createPopupApp(options: PopupAppOptions): {
  destroy: () => void;
  ready: Promise<void>;
} {
  const {
    document,
    locale,
    sendMessage,
    translate,
    createDownload = defaultDownload,
    schedule = window.setTimeout.bind(window),
    cancelSchedule = window.clearTimeout.bind(window),
  } = options;
  const elements = getElements(document);
  let status: PopupStatus | null = null;
  let busy = false;
  let refreshHandle: number | null = null;
  let destroyed = false;

  const formatDate = (isoDate: string): string => {
    const date = new Date(isoDate);
    if (Number.isNaN(date.valueOf())) return translate("unknownDate");
    return new Intl.DateTimeFormat(getLocaleTag(locale), {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  };

  const hideAlert = (): void => {
    elements.alert.textContent = "";
    elements.alert.hidden = true;
  };
  const showAlert = (message: string): void => {
    elements.alert.textContent = message;
    elements.alert.hidden = false;
  };
  const errorMessage = (error: RuntimeError): string => {
    const keys: Record<string, string> = {
      bookmarks_page_required: "errorBookmarksPage",
      content_script_unavailable: "errorReloadPage",
      scrape_failed: "errorCapture",
      capture_timeout: "errorCapture",
      stale_capture: "errorCapture",
      scrape_in_progress: "errorCaptureRunning",
    };
    return translate(keys[error.code] ?? "errorGeneric");
  };
  const captureLabel = (scrape: ScrapeRun | null): string => {
    if (!scrape) return translate("captureIdle");
    const keys: Record<ScrapeRun["status"], string> = {
      idle: "captureIdle",
      running: "captureRunning",
      completed: "captureComplete",
      cancelled: "captureCancelled",
      error: "captureError",
    };
    return translate(keys[scrape.status]);
  };

  const updateDisabledControls = (): void => {
    const running = status?.scrape?.status === "running";
    elements.captureButton.disabled = busy || (!running && !status?.pageReady);
    elements.openBookmarksButton.disabled = busy;
    elements.confirmClearButton.disabled = busy;
    elements.openClearDialogButton.disabled = busy;
    const archiveEmpty = (status?.stats.total ?? 0) === 0;
    elements.exportFullButton.disabled = busy || archiveEmpty;
    elements.exportUrlsButton.disabled = busy || archiveEmpty;
    document.body.toggleAttribute("aria-busy", busy);
  };

  const scheduleRefresh = (): void => {
    if (destroyed || refreshHandle !== null) return;
    refreshHandle = schedule(() => {
      refreshHandle = null;
      void loadStatus(false);
    }, 1_000);
  };

  const render = (): void => {
    const loaded = status !== null;
    elements.loadingView.hidden = loaded;
    elements.dashboardView.hidden = !loaded;
    if (!status) {
      updateDisabledControls();
      return;
    }

    const { pageReady, stats = EMPTY_STATS, scrape } = status;
    elements.pageBadge.dataset.state = pageReady ? "connected" : "disconnected";
    elements.pageLabel.textContent = translate(
      pageReady ? "bookmarksPageReady" : "bookmarksPageMissing",
    );
    elements.pageGuidance.textContent = translate(
      pageReady ? "pageReadyGuidance" : "pageMissingGuidance",
    );
    elements.openBookmarksButton.hidden = pageReady;

    elements.totalCount.textContent = String(stats.total);
    elements.currentCount.textContent = String(stats.current);
    elements.archivedCount.textContent = String(stats.archived);
    elements.lastSync.textContent = stats.lastSuccessfulSyncAt
      ? translate("lastCaptureAt", formatDate(stats.lastSuccessfulSyncAt))
      : translate("neverCaptured");
    elements.emptyNote.hidden = stats.total > 0;

    const running = scrape?.status === "running";
    const showCaptureControls = pageReady || running;
    elements.captureFeedback.hidden = !showCaptureControls;
    elements.captureButton.hidden = !showCaptureControls;
    elements.captureState.textContent = captureLabel(scrape);
    elements.captureState.dataset.state = scrape?.status ?? "idle";
    elements.captureProgress.hidden = !running;
    elements.captureProgressCopy.textContent = running
      ? translate("captureProgress", String(scrape.fetched))
      : "";
    const showDuplicates = scrape?.status === "completed" && scrape.updated > 0;
    elements.duplicateSummary.hidden = !showDuplicates;
    elements.duplicateSummary.textContent = showDuplicates
      ? translate("duplicatesSkipped", String(scrape.updated))
      : "";
    elements.captureButton.dataset.action = running ? "cancel" : "start";
    elements.captureButtonLabel.textContent = translate(
      running ? "cancelCaptureButton" : "captureButton",
    );
    if (scrape?.status === "error" && scrape.errorCode) {
      showAlert(errorMessage({ code: scrape.errorCode, message: "" }));
    }

    updateDisabledControls();
    scheduleRefresh();
  };

  async function loadStatus(showLoading = true): Promise<void> {
    if (destroyed) return;
    if (showLoading) {
      status = null;
      render();
    }
    const response = await sendMessage<PopupStatus>({ type: "GET_STATUS" });
    if (destroyed) return;
    if (!response.ok) {
      status = { pageReady: false, stats: EMPTY_STATS, scrape: null };
      showAlert(errorMessage(response.error));
    } else {
      status = response.data;
      hideAlert();
    }
    render();
  }

  async function perform(
    request: PopupRequest,
    afterSuccess?: (data: unknown) => void,
  ): Promise<void> {
    if (busy) return;
    busy = true;
    hideAlert();
    updateDisabledControls();
    try {
      const response = await sendMessage<unknown>(request);
      if (!response.ok) {
        showAlert(errorMessage(response.error));
        return;
      }
      afterSuccess?.(response.data);
      await loadStatus(false);
    } catch {
      showAlert(translate("errorGeneric"));
    } finally {
      busy = false;
      render();
    }
  }

  elements.openBookmarksButton.addEventListener("click", () => {
    void perform({ type: "OPEN_BOOKMARKS" });
  });
  elements.captureButton.addEventListener("click", () => {
    void perform({
      type:
        elements.captureButton.dataset.action === "cancel"
          ? "CANCEL_SCRAPE"
          : "START_SCRAPE",
    });
  });
  elements.openClearDialogButton.addEventListener("click", () => {
    elements.clearDialog.showModal();
  });
  elements.confirmClearButton.addEventListener("click", () => {
    void perform({ type: "CLEAR_ARCHIVE" });
  });
  const exportArchive = (format: ExportFormat): void => {
    void perform({ type: "EXPORT_BOOKMARKS", payload: { format, locale } }, (data) =>
      createDownload(data as ExportResult),
    );
  };
  elements.exportFullButton.addEventListener("click", () => exportArchive("full"));
  elements.exportUrlsButton.addEventListener("click", () => exportArchive("urls"));

  render();
  const ready = loadStatus();
  return {
    ready,
    destroy: () => {
      destroyed = true;
      if (refreshHandle !== null) cancelSchedule(refreshHandle);
    },
  };
}
