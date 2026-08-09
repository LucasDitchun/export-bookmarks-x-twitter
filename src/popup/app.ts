import type {
  ArchiveStats,
  BookmarkTag,
  ExportFormat,
  ScrapeRun,
  SupportedLocale,
} from "../domain/types";
import { getLocaleTag, type Translator } from "./i18n";
import { createFolderUi } from "./folder-ui";
import type {
  BookmarkDetailResult,
  BookmarkListPage,
  BookmarkView,
  ExportResult,
  NotedBookmark,
  PopupStatus,
  RuntimeError,
  SendMessage,
  TagAssignmentResult,
  TagListResult,
  TagRemovalResult,
  UiRequest,
} from "./protocol";
import { getTagBadgeColors } from "./tag-colors";

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
  libraryEmpty: HTMLElement;
  libraryPanel: HTMLElement;
  libraryStatus: HTMLElement;
  loadMoreBookmarks: HTMLButtonElement;
  loadingView: HTMLElement;
  bookmarkList: HTMLUListElement;
  viewArchivedButton: HTMLButtonElement;
  viewCurrentButton: HTMLButtonElement;
  viewInboxButton: HTMLButtonElement;
  noteEditor: HTMLElement;
  noteSaveStatus: HTMLElement;
  noteTextarea: HTMLTextAreaElement;
  openBookmarksButton: HTMLButtonElement;
  openClearDialogButton: HTMLButtonElement;
  pageBadge: HTMLElement;
  pageGuidance: HTMLElement;
  pageLabel: HTMLElement;
  selectedBookmarkAuthor: HTMLElement;
  selectedCategoryIndicator: HTMLElement;
  selectedBookmarkTitle: HTMLElement;
  selectedTags: HTMLElement;
  tagInput: HTMLInputElement;
  tagStatus: HTMLElement;
  tagSuggestions: HTMLDataListElement;
  totalCount: HTMLElement;
}

interface PendingNoteSave {
  id: string;
  note: string;
  revision: number;
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
    libraryEmpty: requireElement(document, "library-empty"),
    libraryPanel: requireElement(document, "library-view-panel"),
    libraryStatus: requireElement(document, "library-status"),
    loadMoreBookmarks: requireElement(document, "load-more-bookmarks"),
    loadingView: requireElement(document, "loading-view"),
    bookmarkList: requireElement(document, "bookmark-list"),
    viewArchivedButton: requireElement(document, "view-archived-button"),
    viewCurrentButton: requireElement(document, "view-current-button"),
    viewInboxButton: requireElement(document, "view-inbox-button"),
    noteEditor: requireElement(document, "note-editor"),
    noteSaveStatus: requireElement(document, "note-save-status"),
    noteTextarea: requireElement(document, "note-textarea"),
    openBookmarksButton: requireElement(document, "open-bookmarks-button"),
    openClearDialogButton: requireElement(document, "open-clear-dialog-button"),
    pageBadge: requireElement(document, "page-badge"),
    pageGuidance: requireElement(document, "page-guidance"),
    pageLabel: requireElement(document, "page-label"),
    selectedBookmarkAuthor: requireElement(document, "selected-bookmark-author"),
    selectedCategoryIndicator: requireElement(document, "selected-category-indicator"),
    selectedBookmarkTitle: requireElement(document, "selected-bookmark-title"),
    selectedTags: requireElement(document, "selected-tags"),
    tagInput: requireElement(document, "tag-input"),
    tagStatus: requireElement(document, "tag-status"),
    tagSuggestions: requireElement(document, "tag-suggestions"),
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
  elements.tagInput.placeholder = translate("tagInputPlaceholder");
  let status: PopupStatus | null = null;
  let busy = false;
  let refreshHandle: number | null = null;
  let destroyed = false;
  let bookmarks: NotedBookmark[] = [];
  let libraryView: BookmarkView = "inbox";
  let nextBookmarkCursor: string | null = null;
  let selectedBookmarkId: string | null = null;
  let selectedBookmark: NotedBookmark | null = null;
  let tags: BookmarkTag[] = [];
  let tagBusy = false;
  let selectionVersion = 0;
  let libraryGeneration = 0;
  let libraryBusy = false;
  let libraryRefreshPending = false;
  let captureRefreshPending = false;
  let editRevision = 0;
  let noteSaveHandle: number | null = null;
  let debouncedNoteSave: PendingNoteSave | null = null;
  let pendingNoteSave: PendingNoteSave | null = null;
  let noteSaveInFlight = false;
  let folderUi: ReturnType<typeof createFolderUi> | null = null;

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

  const tagById = (id: string): BookmarkTag | undefined =>
    tags.find((tag) => tag.id === id);

  const createTagBadge = (tag: BookmarkTag, removable: boolean): HTMLElement => {
    const colors = getTagBadgeColors(tag.normalizedName ?? tag.name);
    const badge = document.createElement(removable ? "button" : "span");
    const name = document.createElement("span");
    badge.className = removable ? "tag-badge tag-badge-remove" : "tag-badge";
    badge.dataset.tagId = tag.id;
    badge.style.backgroundColor = colors.background;
    badge.style.color = colors.foreground;
    badge.style.borderColor = colors.border;
    name.textContent = tag.name;
    badge.append(name);
    if (removable) {
      const removeIcon = document.createElement("span");
      (badge as HTMLButtonElement).type = "button";
      badge.setAttribute("aria-label", translate("removeTagLabel", tag.name));
      removeIcon.className = "tag-remove-icon";
      removeIcon.textContent = "×";
      removeIcon.setAttribute("aria-hidden", "true");
      badge.append(removeIcon);
      badge.addEventListener("click", () => void removeSelectedTag(tag.id));
    }
    return badge;
  };

  const appendTags = (
    container: HTMLElement,
    tagIds: readonly string[],
    removable: boolean,
  ): void => {
    container.replaceChildren();
    for (const tagId of tagIds) {
      const tag = tagById(tagId);
      if (tag) {
        const item = document.createElement("span");
        item.className = "tag-list-item";
        item.setAttribute("role", "listitem");
        item.append(createTagBadge(tag, removable));
        container.append(item);
      }
    }
  };

  const renderSelectedTags = (): void => {
    appendTags(elements.selectedTags, selectedBookmark?.tagIds ?? [], true);
    elements.tagInput.disabled = selectedBookmark === null || tagBusy;
  };

  const updateBookmarkTags = (updated: NotedBookmark): void => {
    bookmarks = bookmarks.map((bookmark) =>
      bookmark.id === updated.id ? updated : bookmark,
    );
    if (selectedBookmarkId === updated.id) selectedBookmark = updated;
    renderBookmarkList();
    renderSelectedTags();
  };

  const setTagStatus = (
    messageKey: "tagSaving" | "tagAdded" | "tagRemoved" | "tagSaveError" | null,
  ): void => {
    elements.tagStatus.textContent = messageKey ? translate(messageKey) : "";
    elements.tagStatus.dataset.state = messageKey ?? "idle";
  };

  const renderBookmarkList = (): void => {
    elements.bookmarkList.replaceChildren();
    for (const bookmark of bookmarks) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const title = document.createElement("span");
      const author = document.createElement("span");
      const bookmarkTags = document.createElement("span");
      button.type = "button";
      button.className = "bookmark-option";
      button.dataset.bookmarkId = bookmark.id;
      button.toggleAttribute("aria-current", bookmark.id === selectedBookmarkId);
      title.className = "bookmark-option-title";
      title.textContent = bookmark.text || bookmark.url;
      author.className = "bookmark-option-author";
      author.textContent = `@${bookmark.author.username}`;
      bookmarkTags.className = "tag-list bookmark-option-tags";
      bookmarkTags.setAttribute("role", "list");
      appendTags(bookmarkTags, bookmark.tagIds, false);
      button.append(title, author, bookmarkTags);
      button.addEventListener("click", () => void selectBookmark(bookmark.id));
      item.append(button);
      elements.bookmarkList.append(item);
    }
    const emptyMessageKeys: Record<BookmarkView, string> = {
      inbox: "libraryEmptyInbox",
      current: "libraryEmptyCurrent",
      archived: "libraryEmptyArchived",
    };
    elements.libraryEmpty.textContent = translate(emptyMessageKeys[libraryView]);
    elements.libraryEmpty.hidden = bookmarks.length > 0;
    elements.loadMoreBookmarks.hidden = nextBookmarkCursor === null;
    elements.loadMoreBookmarks.disabled = libraryBusy;
  };

  async function addSelectedTag(): Promise<void> {
    const bookmarkId = selectedBookmarkId;
    const name = elements.tagInput.value.trim().normalize("NFKC");
    if (!bookmarkId || tagBusy || name.length === 0 || name.length > 50) return;
    tagBusy = true;
    setTagStatus("tagSaving");
    renderSelectedTags();
    try {
      const response = await sendMessage<TagAssignmentResult>({
        type: "ADD_BOOKMARK_TAG",
        payload: { id: bookmarkId, name },
      });
      if (!response.ok) {
        setTagStatus("tagSaveError");
        return;
      }
      if (!tags.some((tag) => tag.id === response.data.tag.id)) {
        tags = [...tags, response.data.tag];
      }
      updateBookmarkTags(response.data.bookmark);
      renderTagSuggestions();
      if (selectedBookmarkId === bookmarkId) {
        elements.tagInput.value = "";
        setTagStatus("tagAdded");
      }
    } catch {
      setTagStatus("tagSaveError");
    } finally {
      tagBusy = false;
      renderSelectedTags();
    }
  }

  async function removeSelectedTag(tagId: string): Promise<void> {
    const bookmarkId = selectedBookmarkId;
    if (!bookmarkId || tagBusy) return;
    tagBusy = true;
    setTagStatus("tagSaving");
    renderSelectedTags();
    try {
      const response = await sendMessage<TagRemovalResult>({
        type: "REMOVE_BOOKMARK_TAG",
        payload: { id: bookmarkId, tagId },
      });
      if (!response.ok) {
        setTagStatus("tagSaveError");
        return;
      }
      updateBookmarkTags(response.data.bookmark);
      if (selectedBookmarkId === bookmarkId) setTagStatus("tagRemoved");
    } catch {
      setTagStatus("tagSaveError");
    } finally {
      tagBusy = false;
      renderSelectedTags();
    }
  }

  function renderTagSuggestions(): void {
    elements.tagSuggestions.replaceChildren();
    for (const tag of tags) {
      const option = document.createElement("option");
      option.value = tag.name;
      elements.tagSuggestions.append(option);
    }
  }

  function mergeTags(
    loadedTags: readonly BookmarkTag[],
    localTags: readonly BookmarkTag[],
  ): BookmarkTag[] {
    const merged = new Map(loadedTags.map((tag) => [tag.id, tag]));
    for (const tag of localTags) merged.set(tag.id, tag);
    return [...merged.values()];
  }

  async function loadTags(): Promise<void> {
    try {
      const response = await sendMessage<TagListResult>({ type: "LIST_TAGS" });
      if (response.ok && Array.isArray(response.data?.tags)) {
        tags = mergeTags(response.data.tags, tags);
        renderTagSuggestions();
        renderBookmarkList();
        renderSelectedTags();
      }
    } catch {
      // The library and note editor remain usable if tags cannot be loaded.
    }
  }

  const setNoteSaveStatus = (
    messageKey: "noteSaving" | "noteSaved" | "noteSaveError" | null,
  ): void => {
    elements.noteSaveStatus.textContent = messageKey ? translate(messageKey) : "";
    elements.noteSaveStatus.dataset.state = messageKey ?? "idle";
  };

  const resetBookmarkSelection = (discardDraft = false): void => {
    if (!discardDraft) queueDebouncedNote();
    selectionVersion += 1;
    selectedBookmarkId = null;
    selectedBookmark = null;
    editRevision += 1;
    if (noteSaveHandle !== null) cancelSchedule(noteSaveHandle);
    noteSaveHandle = null;
    debouncedNoteSave = null;
    if (discardDraft) pendingNoteSave = null;
    elements.noteEditor.hidden = true;
    elements.selectedBookmarkTitle.textContent = "";
    elements.selectedBookmarkAuthor.textContent = "";
    elements.selectedCategoryIndicator.textContent = "";
    elements.noteTextarea.value = "";
    elements.noteTextarea.disabled = true;
    folderUi?.setBookmark(null);
    setNoteSaveStatus(null);
    setTagStatus(null);
    renderSelectedTags();
  };

  const resetLibrary = (discardDraft = false): void => {
    libraryGeneration += 1;
    libraryBusy = false;
    libraryRefreshPending = false;
    bookmarks = [];
    nextBookmarkCursor = null;
    resetBookmarkSelection(discardDraft);
    renderBookmarkList();
  };

  const viewButtons: Record<BookmarkView, HTMLButtonElement> = {
    inbox: elements.viewInboxButton,
    current: elements.viewCurrentButton,
    archived: elements.viewArchivedButton,
  };
  const viewOrder: BookmarkView[] = ["inbox", "current", "archived"];

  const renderLibraryView = (): void => {
    for (const view of viewOrder) {
      const selected = view === libraryView;
      const button = viewButtons[view];
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    elements.libraryPanel.setAttribute("aria-labelledby", viewButtons[libraryView].id);
    renderBookmarkList();
  };

  const selectLibraryView = (view: BookmarkView, focus = false): void => {
    if (view === libraryView) {
      if (focus) viewButtons[view].focus();
      return;
    }
    resetLibrary();
    libraryView = view;
    elements.libraryStatus.textContent = translate("libraryLoading");
    renderLibraryView();
    if (focus) viewButtons[view].focus();
    void loadLibrary(undefined, false);
  };

  const queueDebouncedNote = (): void => {
    if (!debouncedNoteSave) return;
    if (noteSaveHandle !== null) {
      cancelSchedule(noteSaveHandle);
      noteSaveHandle = null;
    }
    pendingNoteSave = debouncedNoteSave;
    debouncedNoteSave = null;
    void drainNoteSaves();
  };

  async function drainNoteSaves(): Promise<void> {
    if (destroyed || noteSaveInFlight || !pendingNoteSave) return;
    const save = pendingNoteSave;
    pendingNoteSave = null;
    noteSaveInFlight = true;
    try {
      const response = await sendMessage<BookmarkDetailResult>({
        type: "SAVE_BOOKMARK_NOTE",
        payload: { id: save.id, note: save.note },
      });
      const isLatestVisibleDraft =
        selectedBookmarkId === save.id &&
        editRevision === save.revision &&
        elements.noteTextarea.value === save.note &&
        !pendingNoteSave &&
        !debouncedNoteSave;
      if (isLatestVisibleDraft) {
        setNoteSaveStatus(response.ok ? "noteSaved" : "noteSaveError");
      }
    } catch {
      if (
        selectedBookmarkId === save.id &&
        editRevision === save.revision &&
        !pendingNoteSave &&
        !debouncedNoteSave
      ) {
        setNoteSaveStatus("noteSaveError");
      }
    } finally {
      noteSaveInFlight = false;
      if (pendingNoteSave) void drainNoteSaves();
    }
  }

  const stageNoteSave = (): void => {
    if (!selectedBookmarkId || elements.noteTextarea.disabled) return;
    const revision = ++editRevision;
    debouncedNoteSave = {
      id: selectedBookmarkId,
      note: elements.noteTextarea.value,
      revision,
    };
    setNoteSaveStatus("noteSaving");
    if (noteSaveHandle !== null) cancelSchedule(noteSaveHandle);
    noteSaveHandle = schedule(() => {
      noteSaveHandle = null;
      queueDebouncedNote();
    }, 400);
  };

  const flushPendingNoteBeforeDestroy = (): void => {
    if (noteSaveHandle !== null) {
      cancelSchedule(noteSaveHandle);
      noteSaveHandle = null;
    }
    const latestDraft = debouncedNoteSave ?? pendingNoteSave;
    debouncedNoteSave = null;
    pendingNoteSave = null;
    if (latestDraft === null) return;

    void sendMessage<BookmarkDetailResult>({
      type: "SAVE_BOOKMARK_NOTE",
      payload: { id: latestDraft.id, note: latestDraft.note },
    }).catch(() => undefined);
  };

  async function selectBookmark(id: string): Promise<void> {
    if (selectedBookmarkId !== id) queueDebouncedNote();
    const version = ++selectionVersion;
    selectedBookmarkId = id;
    selectedBookmark = null;
    renderSelectedTags();
    elements.noteEditor.hidden = true;
    elements.selectedBookmarkTitle.textContent = "";
    elements.selectedBookmarkAuthor.textContent = "";
    elements.selectedCategoryIndicator.textContent = "";
    elements.noteTextarea.value = "";
    elements.noteTextarea.disabled = true;
    folderUi?.setBookmark(null);
    elements.noteSaveStatus.textContent = translate("noteLoading");
    renderBookmarkList();
    const response = await sendMessage<BookmarkDetailResult>({
      type: "GET_BOOKMARK",
      payload: { id },
    });
    if (destroyed || version !== selectionVersion || selectedBookmarkId !== id) return;
    if (!response.ok || !response.data?.bookmark) {
      elements.noteEditor.hidden = true;
      elements.noteSaveStatus.textContent = translate("noteLoadError");
      return;
    }
    const bookmark = response.data.bookmark;
    selectedBookmark = bookmark;
    elements.noteEditor.hidden = false;
    elements.selectedBookmarkTitle.textContent = bookmark.text || bookmark.url;
    elements.selectedBookmarkAuthor.textContent = `@${bookmark.author.username}`;
    const isCategorized =
      bookmark.note.trim().length > 0 &&
      bookmark.folderId !== null &&
      bookmark.tagIds.length > 0;
    elements.selectedCategoryIndicator.textContent = translate(
      isCategorized ? "bookmarkCategorized" : "bookmarkNeedsCategory",
    );
    elements.selectedCategoryIndicator.dataset.state = isCategorized
      ? "categorized"
      : "incomplete";
    elements.noteTextarea.value = bookmark.note;
    folderUi?.setBookmark(bookmark);
    editRevision += 1;
    elements.noteTextarea.disabled = false;
    setNoteSaveStatus(null);
    setTagStatus(null);
    renderSelectedTags();
    renderBookmarkList();
  }

  async function loadLibrary(cursor?: string, selectFirst = true): Promise<void> {
    if (destroyed || libraryBusy) return;
    const generation = libraryGeneration;
    const requestedView = libraryView;
    libraryBusy = true;
    elements.libraryStatus.textContent = translate("libraryLoading");
    renderBookmarkList();
    try {
      const response = await sendMessage<BookmarkListPage>({
        type: "LIST_BOOKMARKS",
        payload: { view: requestedView, ...(cursor ? { cursor } : {}) },
      });
      if (
        generation !== libraryGeneration ||
        !response.ok ||
        !response.data ||
        !Array.isArray(response.data.items)
      ) {
        if (generation !== libraryGeneration) return;
        elements.libraryStatus.textContent = translate("libraryLoadError");
        return;
      }
      bookmarks = cursor ? [...bookmarks, ...response.data.items] : response.data.items;
      nextBookmarkCursor = response.data.nextCursor;
      if (
        selectedBookmarkId &&
        !bookmarks.some((bookmark) => bookmark.id === selectedBookmarkId)
      ) {
        resetBookmarkSelection();
      }
      elements.libraryStatus.textContent = "";
      renderBookmarkList();
      if (selectFirst && !selectedBookmarkId && bookmarks[0]) {
        await selectBookmark(bookmarks[0].id);
      }
    } catch {
      if (generation === libraryGeneration) {
        elements.libraryStatus.textContent = translate("libraryLoadError");
      }
    } finally {
      if (generation === libraryGeneration) {
        libraryBusy = false;
        renderBookmarkList();
        if (libraryRefreshPending) {
          libraryRefreshPending = false;
          void loadLibrary(undefined, false);
        }
      }
    }
  }

  async function refreshLibraryWhenAvailable(): Promise<void> {
    if (libraryBusy) {
      libraryRefreshPending = true;
      return;
    }
    await loadLibrary(undefined, false);
  }

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
    if (running) scheduleRefresh();
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
    if (captureRefreshPending && status.scrape?.status !== "running") {
      const captureCompleted = status.scrape?.status === "completed";
      captureRefreshPending = false;
      if (captureCompleted) await refreshLibraryWhenAvailable();
    }
  }

  async function perform(
    request: UiRequest,
    afterSuccess?: (data: unknown) => void | Promise<void>,
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
      await afterSuccess?.(response.data);
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
    const isCancel = elements.captureButton.dataset.action === "cancel";
    void perform(
      { type: isCancel ? "CANCEL_SCRAPE" : "START_SCRAPE" },
      isCancel
        ? undefined
        : () => {
            captureRefreshPending = true;
          },
    );
  });
  elements.openClearDialogButton.addEventListener("click", () => {
    elements.clearDialog.showModal();
  });
  elements.confirmClearButton.addEventListener("click", () => {
    void perform({ type: "CLEAR_ARCHIVE" }, async () => {
      resetLibrary(true);
      await loadLibrary(undefined, false);
    });
  });
  const exportArchive = (format: ExportFormat): void => {
    void perform({ type: "EXPORT_BOOKMARKS", payload: { format, locale } }, (data) =>
      createDownload(data as ExportResult),
    );
  };
  elements.exportFullButton.addEventListener("click", () => exportArchive("full"));
  elements.exportUrlsButton.addEventListener("click", () => exportArchive("urls"));
  elements.loadMoreBookmarks.addEventListener("click", () => {
    if (nextBookmarkCursor) void loadLibrary(nextBookmarkCursor);
  });
  for (const view of viewOrder) {
    const button = viewButtons[view];
    button.addEventListener("click", () => selectLibraryView(view));
    button.addEventListener("keydown", (event) => {
      let nextIndex: number | null = null;
      const currentIndex = viewOrder.indexOf(view);
      if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % viewOrder.length;
      if (event.key === "ArrowLeft") {
        nextIndex = (currentIndex - 1 + viewOrder.length) % viewOrder.length;
      }
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = viewOrder.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      selectLibraryView(viewOrder[nextIndex]!, true);
    });
  }
  elements.noteTextarea.addEventListener("input", stageNoteSave);
  elements.noteTextarea.addEventListener("blur", queueDebouncedNote);
  elements.tagInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    void addSelectedTag();
  });

  folderUi = createFolderUi({
    document,
    sendMessage,
    translate,
    onBookmarkUpdated: (updatedBookmark) => {
      updateBookmarkTags(updatedBookmark);
    },
  });

  renderLibraryView();
  render();
  const ready = Promise.all([
    loadStatus(),
    loadLibrary(),
    loadTags(),
    folderUi.ready,
  ]).then(() => undefined);
  return {
    ready,
    destroy: () => {
      if (destroyed) return;
      flushPendingNoteBeforeDestroy();
      destroyed = true;
      if (refreshHandle !== null) cancelSchedule(refreshHandle);
    },
  };
}
