import type {
  ArchiveStats,
  BookmarkTag,
  FolderRecord,
  ScrapeRun,
  SupportedLocale,
} from "../domain/types";
import { reciprocalRankFusion } from "../domain/semantic-search";
import {
  DEFAULT_BOOKMARK_CATEGORIZATION_FIELDS,
  isBookmarkCategorized,
  type BookmarkCategorizationFields,
} from "../domain/bookmark-categorization";
import { createBackupUi } from "./backup-ui";
import { getLocaleTag, type Translator } from "./i18n";
import { organizationUsageLabel } from "./organization-usage-label";
import { createFolderUi } from "./folder-ui";
import type {
  BookmarkDetailResult,
  BookmarkListPage,
  BookmarkSearchPage,
  BookmarkView,
  ExportResult,
  LiveBookmarkContext,
  NotedBookmark,
  OrganizationTrashResult,
  PopupStatus,
  RuntimeError,
  SendMessage,
  TagAssignmentResult,
  TagDeleteResult,
  TagDetailResult,
  TagListResult,
  TagRemovalResult,
  UiRequest,
} from "./protocol";
import { getTagBadgeColors } from "./tag-colors";
import { createExportUi } from "./export-ui";
import {
  DEFAULT_DATE_TIME_PREFERENCES,
  formatRegionalDate,
  formatRegionalTime,
  type DateTimePreferences,
} from "../settings/date-time-preferences";
import { DEFAULT_QUICK_STOP_THRESHOLD } from "../domain/quick-update";
import { createIconButton } from "../ui/icons";
import { downloadExport } from "./download";
import { createNoteAutosave } from "./note-autosave";
import { getPopupElements } from "./popup-dom";

interface PopupAppOptions {
  document: Document;
  locale: SupportedLocale;
  sendMessage: SendMessage;
  translate: Translator;
  createDownload?: (result: ExportResult) => void;
  schedule?: typeof window.setTimeout;
  cancelSchedule?: typeof window.clearTimeout;
  readBackupFile?: (file: File) => Promise<string>;
  confirmRestore?: (message: string) => boolean;
  confirmDelete?: (message: string) => boolean;
  promptTagName?: (message: string, value: string) => string | null;
  reload?: () => void;
  filterAsYouType?: boolean;
  onBookmarkOpened?: () => void;
  semanticSearch?: (
    query: string,
    view: BookmarkView,
    limit: number,
  ) => Promise<NotedBookmark[] | null>;
  categorizationFields?: BookmarkCategorizationFields;
  dateTimePreferences?: DateTimePreferences;
  quickStopThreshold?: number;
}

const EMPTY_STATS: ArchiveStats = {
  total: 0,
  current: 0,
  archived: 0,
  lastSuccessfulSyncAt: null,
};

export function createPopupApp(options: PopupAppOptions): {
  destroy: () => void;
  handleLiveBookmarkContext: (context: LiveBookmarkContext) => Promise<void>;
  ready: Promise<void>;
  setCategorizationFields: (fields: BookmarkCategorizationFields) => void;
  setDateTimePreferences: (preferences: DateTimePreferences) => void;
  setFilterAsYouType: (enabled: boolean) => void;
  setQuickStopThreshold: (threshold: number) => void;
} {
  const {
    document,
    locale,
    sendMessage,
    translate,
    createDownload = downloadExport,
    schedule = window.setTimeout.bind(window),
    cancelSchedule = window.clearTimeout.bind(window),
    readBackupFile = (file) => file.text(),
    confirmRestore = (message) => window.confirm(message),
    confirmDelete = (message) => window.confirm(message),
    promptTagName = (message, value) => window.prompt(message, value),
    reload = () => window.location.reload(),
    filterAsYouType: initialFilterAsYouType = true,
    onBookmarkOpened,
    semanticSearch,
    categorizationFields:
      initialCategorizationFields = DEFAULT_BOOKMARK_CATEGORIZATION_FIELDS,
    dateTimePreferences: initialDateTimePreferences = DEFAULT_DATE_TIME_PREFERENCES,
    quickStopThreshold: initialQuickStopThreshold = DEFAULT_QUICK_STOP_THRESHOLD,
  } = options;
  const elements = getPopupElements(document);
  elements.tagInput.placeholder = translate("tagInputPlaceholder");
  elements.librarySearch.placeholder = translate("searchPlaceholder");
  let status: PopupStatus | null = null;
  let busy = false;
  let refreshHandle: number | null = null;
  let destroyed = false;
  let bookmarks: NotedBookmark[] = [];
  let libraryView: BookmarkView = "inbox";
  let nextBookmarkCursor: string | null = null;
  let selectedBookmarkId: string | null = null;
  let selectedBookmark: NotedBookmark | null = null;
  let categorizationFields = initialCategorizationFields;
  let dateTimePreferences = initialDateTimePreferences;
  let quickStopThreshold = initialQuickStopThreshold;
  let tags: BookmarkTag[] = [];
  let deletedTags: BookmarkTag[] = [];
  let deletedFolders: FolderRecord[] = [];
  const deletedTagIds = new Set<string>();
  let tagUsage: Record<string, number> = {};
  let folderCount = 0;
  let activeFolderIds = new Set<string>();
  let tagBusy = false;
  let trashBusy = false;
  let selectionVersion = 0;
  let libraryGeneration = 0;
  let libraryBusy = false;
  let libraryRefreshPending = false;
  let searchQuery = "";
  let searchHandle: number | null = null;
  let filterAsYouType = initialFilterAsYouType;
  let libraryRefreshWaiters: Array<() => void> = [];
  let captureRefreshPending = false;
  let captureModeTouched = false;
  let folderUi: ReturnType<typeof createFolderUi> | null = null;
  let backupUi: ReturnType<typeof createBackupUi> | null = null;
  let exportUi: ReturnType<typeof createExportUi> | null = null;
  const handledLiveContexts = new Set<string>();

  const formatDate = (isoDate: string): string => {
    const date = new Date(isoDate);
    if (Number.isNaN(date.valueOf())) return translate("unknownDate");
    const localeTag = getLocaleTag(locale);
    return translate("dateTimePattern", [
      formatRegionalDate(date, localeTag, dateTimePreferences.dateFormat),
      formatRegionalTime(date, localeTag, dateTimePreferences.timeFormat),
    ]);
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
      capture_loading_timeout: "errorCapture",
      capture_navigation_changed: "errorCapture",
      scrape_incomplete: "errorCapture",
      stale_capture: "errorCapture",
      scrape_in_progress: "errorCaptureRunning",
      invalid_backup: "errorInvalidBackup",
      restore_capture_running: "errorRestoreCaptureRunning",
      restore_settings_failed: "errorRestoreSettingsFailed",
      export_fields_required: "exportFieldRequired",
    };
    return translate(keys[error.code] ?? "errorGeneric");
  };
  const captureLabel = (scrape: ScrapeRun | null): string => {
    if (!scrape) return translate("captureIdle");
    if (scrape.status === "running") {
      return translate(
        scrape.mode === "quick" ? "captureRunningQuick" : "captureRunningFull",
      );
    }
    if (scrape.status === "completed") {
      if (scrape.completionReason === "checkpoint_stop") {
        return translate("captureCompleteQuick");
      }
      if (scrape.completionReason === "full_fallback") {
        return translate("captureCompleteFallback");
      }
      return translate("captureCompleteFull");
    }
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
    elements.captureModeSelect.disabled = busy || running || !status?.pageReady;
    elements.openBookmarksButton.disabled = busy;
    elements.confirmClearButton.disabled = busy;
    elements.openClearDialogButton.disabled = busy;
    const archiveEmpty = (status?.stats.total ?? 0) === 0;
    exportUi?.setDisabled(busy || archiveEmpty);
    backupUi?.setDisabled(busy, running);
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

  const renderSelectedCategoryIndicator = (): void => {
    if (selectedBookmark === null) {
      elements.selectedCategoryIndicator.textContent = "";
      elements.selectedCategoryIndicator.dataset.state = "empty";
      return;
    }
    const activeTagIds = new Set(tags.map(({ id }) => id));
    const categorized = isBookmarkCategorized(
      {
        ...selectedBookmark,
        folderId:
          selectedBookmark.folderId !== null &&
          activeFolderIds.has(selectedBookmark.folderId)
            ? selectedBookmark.folderId
            : null,
        tagIds: selectedBookmark.tagIds.filter((id) => activeTagIds.has(id)),
      },
      categorizationFields,
    );
    elements.selectedCategoryIndicator.textContent = translate(
      categorized ? "bookmarkCategorized" : "bookmarkNeedsCategory",
    );
    elements.selectedCategoryIndicator.dataset.state = categorized
      ? "categorized"
      : "incomplete";
  };

  const updateBookmark = (updated: NotedBookmark): void => {
    bookmarks = bookmarks.map((bookmark) =>
      bookmark.id === updated.id ? updated : bookmark,
    );
    if (selectedBookmarkId === updated.id) selectedBookmark = updated;
    renderBookmarkList();
    renderSelectedTags();
    renderSelectedCategoryIndicator();
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
      const savedAt = document.createElement("span");
      const bookmarkTags = document.createElement("span");
      button.type = "button";
      button.className = "bookmark-option";
      button.dataset.bookmarkId = bookmark.id;
      button.toggleAttribute("aria-current", bookmark.id === selectedBookmarkId);
      title.className = "bookmark-option-title";
      title.textContent = bookmark.text || bookmark.url;
      author.className = "bookmark-option-author";
      author.textContent = `@${bookmark.author.username}`;
      savedAt.className = "bookmark-option-date";
      savedAt.textContent = translate(
        "bookmarkSavedAt",
        formatDate(bookmark.firstSavedAt),
      );
      bookmarkTags.className = "tag-list bookmark-option-tags";
      bookmarkTags.setAttribute("role", "list");
      appendTags(bookmarkTags, bookmark.tagIds, false);
      button.append(title, author, savedAt, bookmarkTags);
      button.addEventListener("click", () => void selectBookmark(bookmark.id, true));
      item.append(button);
      elements.bookmarkList.append(item);
    }
    const emptyMessageKeys: Record<BookmarkView, string> = {
      inbox: "libraryEmptyInbox",
      current: "libraryEmptyCurrent",
      archived: "libraryEmptyArchived",
    };
    elements.libraryEmpty.textContent = translate(
      searchQuery ? "searchEmpty" : emptyMessageKeys[libraryView],
    );
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
      exportUi?.setTags(tags);
      updateBookmark(response.data.bookmark);
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
      void loadTags();
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
      updateBookmark(response.data.bookmark);
      if (selectedBookmarkId === bookmarkId) setTagStatus("tagRemoved");
    } catch {
      setTagStatus("tagSaveError");
    } finally {
      tagBusy = false;
      renderSelectedTags();
      void loadTags();
    }
  }

  const filterLibraryByOrganization = (query: string): void => {
    elements.librarySearch.value = query;
    activateSearchQuery(query);
  };

  function renderOrganizationTrash(): void {
    const count = deletedTags.length + deletedFolders.length;
    elements.organizationTrashCount.textContent = String(count);
    elements.organizationTrashEmpty.hidden = count > 0;
    elements.organizationTrashEmpty.textContent = translate("organizationTrashEmpty");
    elements.trashTagList.replaceChildren();
    elements.trashFolderList.replaceChildren();

    const appendTrashItem = (
      list: HTMLUListElement,
      kind: "tag" | "folder",
      id: string,
      name: string,
    ): void => {
      const item = document.createElement("li");
      const label = document.createElement("span");
      const restore = createIconButton({
        document,
        icon: "restore",
        label: translate(kind === "tag" ? "restoreTag" : "restoreFolder", name),
      });
      item.className = "trash-item";
      label.textContent = name;
      restore.dataset.trashKind = kind;
      restore.dataset.trashId = id;
      restore.disabled = trashBusy;
      restore.addEventListener("click", () => void restoreTrashItem(kind, id));
      item.append(label, restore);
      list.append(item);
    };
    for (const folder of deletedFolders) {
      appendTrashItem(elements.trashFolderList, "folder", folder.id, folder.name);
    }
    for (const tag of deletedTags) {
      appendTrashItem(elements.trashTagList, "tag", tag.id, tag.name);
    }
  }

  async function loadOrganizationTrash(): Promise<void> {
    try {
      const response = await sendMessage<OrganizationTrashResult>({
        type: "LIST_ORGANIZATION_TRASH",
      });
      if (!response.ok) throw new Error("trash list failed");
      deletedTags = Array.isArray(response.data?.tags) ? response.data.tags : [];
      deletedFolders = Array.isArray(response.data?.folders)
        ? response.data.folders
        : [];
      elements.organizationTrashStatus.textContent = "";
    } catch {
      elements.organizationTrashStatus.textContent = translate(
        "organizationTrashError",
      );
    } finally {
      renderOrganizationTrash();
    }
  }

  async function restoreTrashItem(kind: "tag" | "folder", id: string): Promise<void> {
    if (trashBusy) return;
    trashBusy = true;
    elements.organizationTrashStatus.textContent = translate("organizationRestoring");
    renderOrganizationTrash();
    try {
      const response = await sendMessage<unknown>({
        type: kind === "tag" ? "RESTORE_TAG" : "RESTORE_FOLDER",
        payload: { id },
      });
      if (!response.ok) throw new Error("restore failed");
      if (kind === "tag") deletedTagIds.delete(id);
      await Promise.all([
        loadOrganizationTrash(),
        kind === "tag" ? loadTags() : folderUi?.refresh(),
      ]);
      elements.organizationTrashStatus.textContent = translate("organizationRestored");
      renderSelectedCategoryIndicator();
    } catch {
      elements.organizationTrashStatus.textContent = translate(
        "organizationRestoreError",
      );
    } finally {
      trashBusy = false;
      renderOrganizationTrash();
    }
  }

  function renderOrganizationOverview(): void {
    elements.organizationCounts.textContent = translate("organizationCounts", [
      String(folderCount),
      String(tags.length),
    ]);
    elements.tagOverviewList.replaceChildren();
    for (const tag of tags) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const name = document.createElement("span");
      const count = document.createElement("strong");
      const actions = document.createElement("span");
      const rename = createIconButton({
        document,
        icon: "edit",
        label: translate("renameTag"),
      });
      const remove = createIconButton({
        document,
        icon: "trash",
        label: translate("deleteTag"),
        className: "danger",
      });
      button.type = "button";
      button.className = "organization-item";
      button.setAttribute(
        "aria-label",
        organizationUsageLabel(
          translate,
          "tagUsageLabel",
          tag.name,
          tagUsage[tag.id] ?? 0,
        ),
      );
      name.textContent = tag.name;
      count.textContent = String(tagUsage[tag.id] ?? 0);
      button.append(name, count);
      button.addEventListener("click", () => filterLibraryByOrganization(tag.name));
      actions.className = "organization-item-actions";
      rename.addEventListener("click", () => void renameTag(tag));
      remove.addEventListener("click", () => void deleteTag(tag));
      actions.append(rename, remove);
      item.append(button, actions);
      elements.tagOverviewList.append(item);
    }
  }

  async function renameTag(tag: BookmarkTag): Promise<void> {
    const name = promptTagName(translate("renameTagPrompt"), tag.name);
    if (name === null || name.trim() === tag.name || tagBusy) return;
    tagBusy = true;
    try {
      const response = await sendMessage<TagDetailResult>({
        type: "RENAME_TAG",
        payload: { id: tag.id, name },
      });
      if (!response.ok) throw new Error("rename tag failed");
      tags = tags.map((candidate) =>
        candidate.id === tag.id ? response.data.tag : candidate,
      );
      renderOrganizationOverview();
      renderTagSuggestions();
      renderSelectedTags();
    } catch {
      setTagStatus("tagSaveError");
    } finally {
      tagBusy = false;
    }
  }

  async function deleteTag(tag: BookmarkTag): Promise<void> {
    if (
      tagBusy ||
      !confirmDelete(
        translate("deleteTagConfirmation", [tag.name, String(tagUsage[tag.id] ?? 0)]),
      )
    ) {
      return;
    }
    tagBusy = true;
    try {
      const response = await sendMessage<TagDeleteResult>({
        type: "DELETE_TAG",
        payload: { id: tag.id },
      });
      if (!response.ok) throw new Error("delete tag failed");
      tags = tags.filter((candidate) => candidate.id !== tag.id);
      deletedTagIds.add(tag.id);
      delete tagUsage[tag.id];
      renderOrganizationOverview();
      renderTagSuggestions();
      renderBookmarkList();
      renderSelectedTags();
      renderSelectedCategoryIndicator();
      void loadOrganizationTrash();
    } catch {
      setTagStatus("tagSaveError");
    } finally {
      tagBusy = false;
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
    const merged = new Map(
      loadedTags
        .filter((tag) => !deletedTagIds.has(tag.id))
        .map((tag) => [tag.id, tag]),
    );
    for (const tag of localTags) {
      if (!deletedTagIds.has(tag.id)) merged.set(tag.id, tag);
    }
    return [...merged.values()];
  }

  async function loadTags(): Promise<void> {
    try {
      const response = await sendMessage<TagListResult>({ type: "LIST_TAGS" });
      if (response.ok && Array.isArray(response.data?.tags)) {
        tags = mergeTags(response.data.tags, tags);
        tagUsage = response.data.usage ?? {};
        exportUi?.setTags(tags);
        renderTagSuggestions();
        renderBookmarkList();
        renderSelectedTags();
        renderOrganizationOverview();
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

  const noteAutosave = createNoteAutosave({
    sendMessage,
    schedule,
    cancelSchedule,
    getVisibleDraft: () =>
      selectedBookmarkId && !elements.noteTextarea.disabled
        ? { id: selectedBookmarkId, note: elements.noteTextarea.value }
        : null,
    onSaved: updateBookmark,
    onStatus: setNoteSaveStatus,
  });

  const resetBookmarkSelection = (discardDraft = false): void => {
    selectionVersion += 1;
    noteAutosave.select(null, discardDraft);
    selectedBookmarkId = null;
    selectedBookmark = null;
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
    for (const resolveWaiter of libraryRefreshWaiters) resolveWaiter();
    libraryRefreshWaiters = [];
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
    void loadActiveLibrary(undefined, false);
  };

  const stageNoteSave = (): void => {
    if (!selectedBookmarkId || elements.noteTextarea.disabled) return;
    noteAutosave.stage(elements.noteTextarea.value);
  };

  async function selectBookmark(id: string, explicitOpen = false): Promise<void> {
    if (selectedBookmarkId !== id) noteAutosave.flush();
    const version = ++selectionVersion;
    selectedBookmarkId = id;
    noteAutosave.select(id);
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
    renderSelectedCategoryIndicator();
    elements.noteTextarea.value = bookmark.note;
    folderUi?.setBookmark(bookmark);
    elements.noteTextarea.disabled = false;
    setNoteSaveStatus(null);
    setTagStatus(null);
    renderSelectedTags();
    renderBookmarkList();
    if (explicitOpen) onBookmarkOpened?.();
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
        destroyed ||
        generation !== libraryGeneration ||
        !response.ok ||
        !response.data ||
        !Array.isArray(response.data.items)
      ) {
        if (destroyed || generation !== libraryGeneration) return;
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
      if (!destroyed && generation === libraryGeneration) {
        elements.libraryStatus.textContent = translate("libraryLoadError");
      }
    } finally {
      if (!destroyed && generation === libraryGeneration) {
        libraryBusy = false;
        renderBookmarkList();
        drainPendingLibraryRefresh();
      }
    }
  }

  async function loadSearch(cursor?: string, selectFirst = true): Promise<void> {
    if (destroyed || libraryBusy || searchQuery.length === 0) return;
    const generation = libraryGeneration;
    const requestedView = libraryView;
    const requestedQuery = searchQuery;
    libraryBusy = true;
    elements.librarySearchStatus.textContent = translate("searching");
    renderBookmarkList();
    try {
      const semanticPromise =
        cursor || semanticSearch === undefined
          ? null
          : semanticSearch(requestedQuery, requestedView, 50).catch(() => null);
      const response = await sendMessage<BookmarkSearchPage>({
        type: "SEARCH_BOOKMARKS",
        payload: {
          query: requestedQuery,
          view: requestedView,
          ...(cursor ? { cursor } : {}),
        },
      });
      const semanticItems = semanticPromise === null ? null : await semanticPromise;
      if (
        destroyed ||
        generation !== libraryGeneration ||
        requestedQuery !== searchQuery ||
        !response.ok ||
        !response.data ||
        !Array.isArray(response.data.items)
      ) {
        if (
          destroyed ||
          generation !== libraryGeneration ||
          requestedQuery !== searchQuery
        ) {
          return;
        }
        elements.librarySearchStatus.textContent = translate("searchLoadError");
        return;
      }
      const fused =
        semanticItems === null
          ? response.data.items
          : reciprocalRankFusion(response.data.items, semanticItems)
              .slice(0, 100)
              .map(({ bookmark }) => bookmark);
      bookmarks = cursor
        ? [...bookmarks, ...fused].filter(
            (bookmark, index, all) =>
              all.findIndex(({ id }) => id === bookmark.id) === index,
          )
        : fused;
      nextBookmarkCursor = response.data.nextCursor;
      if (
        selectedBookmarkId &&
        !bookmarks.some((bookmark) => bookmark.id === selectedBookmarkId)
      ) {
        resetBookmarkSelection();
      }
      elements.libraryStatus.textContent = "";
      elements.librarySearchStatus.textContent = translate(
        "searchResultsCount",
        String(semanticItems === null ? response.data.total : bookmarks.length),
      );
      renderBookmarkList();
      if (selectFirst && !selectedBookmarkId && bookmarks[0]) {
        await selectBookmark(bookmarks[0].id);
      }
    } catch {
      if (
        !destroyed &&
        generation === libraryGeneration &&
        requestedQuery === searchQuery
      ) {
        elements.librarySearchStatus.textContent = translate("searchLoadError");
      }
    } finally {
      if (
        !destroyed &&
        generation === libraryGeneration &&
        requestedQuery === searchQuery
      ) {
        libraryBusy = false;
        renderBookmarkList();
        drainPendingLibraryRefresh();
      }
    }
  }

  function loadActiveLibrary(cursor?: string, selectFirst = true): Promise<void> {
    return searchQuery
      ? loadSearch(cursor, selectFirst)
      : loadLibrary(cursor, selectFirst);
  }

  function drainPendingLibraryRefresh(): void {
    if (destroyed || libraryBusy || !libraryRefreshPending) return;
    libraryRefreshPending = false;
    const waiters = libraryRefreshWaiters;
    libraryRefreshWaiters = [];
    void loadActiveLibrary(undefined, false).finally(() => {
      for (const resolveWaiter of waiters) resolveWaiter();
    });
  }

  const cancelPendingSearch = (): void => {
    if (searchHandle !== null) cancelSchedule(searchHandle);
    searchHandle = null;
  };

  const activateSearchQuery = (nextQuery: string): void => {
    cancelPendingSearch();
    searchQuery = nextQuery;
    libraryGeneration += 1;
    libraryBusy = false;
    bookmarks = [];
    nextBookmarkCursor = null;
    elements.librarySearchStatus.textContent = searchQuery
      ? translate("searching")
      : "";
    renderBookmarkList();
    if (!searchQuery) {
      void loadLibrary(undefined, false);
      return;
    }
    void loadSearch(undefined, false);
  };

  const submitSearch = (): void => {
    activateSearchQuery(elements.librarySearch.value.trim());
  };

  const updateSearchQuery = (): void => {
    cancelPendingSearch();
    const nextQuery = elements.librarySearch.value.trim();
    if (!nextQuery) {
      activateSearchQuery("");
      return;
    }

    libraryGeneration += 1;
    libraryBusy = false;
    if (!filterAsYouType) {
      elements.librarySearchStatus.textContent = translate("searchReady");
      renderBookmarkList();
      drainPendingLibraryRefresh();
      return;
    }

    elements.librarySearchStatus.textContent = translate("searching");
    searchHandle = schedule(() => {
      searchHandle = null;
      activateSearchQuery(nextQuery);
    }, 150);
  };

  const setFilterAsYouType = (enabled: boolean): void => {
    if (filterAsYouType === enabled) return;
    filterAsYouType = enabled;
    updateSearchQuery();
  };

  async function refreshLibraryWhenAvailable(): Promise<void> {
    if (libraryBusy) {
      libraryRefreshPending = true;
      await new Promise<void>((resolve) => {
        libraryRefreshWaiters.push(resolve);
      });
      return;
    }
    await loadActiveLibrary(undefined, false);
  }

  async function handleLiveBookmarkContext(
    context: LiveBookmarkContext,
  ): Promise<void> {
    if (destroyed || (context.state !== "saved" && context.state !== "archived")) {
      return;
    }
    const eventKey = `${context.intentId}:${context.state}`;
    if (handledLiveContexts.has(eventKey)) return;
    handledLiveContexts.add(eventKey);
    if (handledLiveContexts.size > 100) {
      const oldest = handledLiveContexts.values().next().value;
      if (oldest !== undefined) handledLiveContexts.delete(oldest);
    }
    await Promise.all([loadStatus(false), refreshLibraryWhenAvailable()]);
    if (
      context.state === "saved" &&
      selectedBookmarkId === null &&
      bookmarks.some((bookmark) => bookmark.id === context.bookmark.id)
    ) {
      await selectBookmark(context.bookmark.id);
    }
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
    elements.pageGuidance.hidden = pageReady;
    elements.openBookmarksButton.hidden = pageReady;

    elements.currentCount.textContent = String(stats.current);
    elements.lastSync.textContent = stats.lastSuccessfulSyncAt
      ? formatDate(stats.lastSuccessfulSyncAt)
      : translate("neverCaptured");
    elements.emptyNote.hidden = stats.total > 0;

    const running = scrape?.status === "running";
    const showCaptureControls = pageReady || running;
    const quickOption = elements.captureModeSelect.querySelector<HTMLOptionElement>(
      'option[value="quick"]',
    );
    if (quickOption) quickOption.disabled = !status.quickUpdateAvailable;
    if (running && scrape) {
      elements.captureModeSelect.value = scrape.mode;
    } else if (!status.quickUpdateAvailable) {
      elements.captureModeSelect.value = "full";
    } else if (!captureModeTouched) {
      elements.captureModeSelect.value = "quick";
    }
    const selectedMode =
      elements.captureModeSelect.value === "quick" ? "quick" : "full";
    elements.captureModeField.hidden = !showCaptureControls;
    elements.captureModeHelp.textContent = !status.quickUpdateAvailable
      ? translate("captureModeFirstFullHelp")
      : selectedMode === "quick"
        ? translate("captureModeQuickHelp", String(quickStopThreshold))
        : translate("captureModeFullHelp");
    elements.fullReviewReminder.hidden = !status.fullReviewDue || running;
    elements.fullReviewReminder.textContent = status.fullReviewDue
      ? translate("fullReviewReminder")
      : "";
    elements.captureFeedback.hidden =
      !showCaptureControls ||
      scrape === null ||
      scrape.status === "idle" ||
      scrape.status === "cancelled";
    elements.captureFeedback.setAttribute("aria-busy", String(running));
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
      running
        ? "cancelCaptureButton"
        : selectedMode === "quick"
          ? "captureButtonQuick"
          : "captureButtonFull",
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
      status = {
        pageReady: false,
        stats: EMPTY_STATS,
        scrape: null,
        fullReviewDue: false,
        quickUpdateAvailable: false,
      };
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
    afterError?: (error: RuntimeError) => void | Promise<void>,
  ): Promise<void> {
    if (busy) return;
    busy = true;
    hideAlert();
    updateDisabledControls();
    try {
      const response = await sendMessage<unknown>(request);
      if (!response.ok) {
        showAlert(errorMessage(response.error));
        await afterError?.(response.error);
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

  backupUi = createBackupUi({
    document,
    translate,
    perform,
    createDownload,
    readFile: readBackupFile,
    confirmReplace: confirmRestore,
    onDataRestored: async () => {
      resetLibrary(true);
      await loadActiveLibrary(undefined, false);
    },
    reload,
  });
  exportUi = createExportUi({
    document,
    locale,
    translate,
    perform,
    createDownload,
  });
  elements.openBookmarksButton.addEventListener("click", () => {
    void perform({ type: "OPEN_BOOKMARKS" });
  });
  elements.captureButton.addEventListener("click", () => {
    const isCancel = elements.captureButton.dataset.action === "cancel";
    const mode = elements.captureModeSelect.value === "quick" ? "quick" : "full";
    void perform(
      isCancel
        ? { type: "CANCEL_SCRAPE" }
        : { type: "START_SCRAPE", payload: { mode } },
      isCancel
        ? undefined
        : () => {
            captureRefreshPending = true;
          },
    );
  });
  elements.captureModeSelect.addEventListener("change", () => {
    captureModeTouched = true;
    render();
  });
  elements.openClearDialogButton.addEventListener("click", () => {
    elements.clearDialog.showModal();
  });
  elements.confirmClearButton.addEventListener("click", () => {
    void perform({ type: "CLEAR_ARCHIVE" }, async () => {
      resetLibrary(true);
      await loadActiveLibrary(undefined, false);
    });
  });
  elements.loadMoreBookmarks.addEventListener("click", () => {
    if (nextBookmarkCursor) void loadActiveLibrary(nextBookmarkCursor);
  });
  elements.librarySearch.addEventListener("input", updateSearchQuery);
  elements.librarySearch.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    submitSearch();
  });
  elements.librarySearchButton.addEventListener("click", submitSearch);
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
  elements.noteTextarea.addEventListener("blur", () => noteAutosave.flush());
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
      updateBookmark(updatedBookmark);
    },
    onFoldersChanged: (folders: readonly FolderRecord[]) => {
      folderCount = folders.length;
      activeFolderIds = new Set(folders.map(({ id }) => id));
      exportUi?.setFolders(folders);
      renderOrganizationOverview();
      renderSelectedCategoryIndicator();
    },
    onTrashChanged: () => void loadOrganizationTrash(),
    onFolderSelected: filterLibraryByOrganization,
  });

  renderLibraryView();
  render();
  const ready = Promise.all([
    loadStatus(),
    loadLibrary(),
    loadTags(),
    loadOrganizationTrash(),
    folderUi.ready,
  ]).then(() => undefined);
  return {
    ready,
    setCategorizationFields: (fields) => {
      if (destroyed) return;
      categorizationFields = fields;
      renderSelectedCategoryIndicator();
    },
    setDateTimePreferences: (preferences) => {
      if (destroyed) return;
      dateTimePreferences = preferences;
      render();
    },
    setFilterAsYouType: (enabled) => {
      if (!destroyed) setFilterAsYouType(enabled);
    },
    setQuickStopThreshold: (threshold) => {
      if (destroyed) return;
      quickStopThreshold = threshold;
      render();
    },
    handleLiveBookmarkContext,
    destroy: () => {
      if (destroyed) return;
      noteAutosave.destroy();
      destroyed = true;
      for (const resolveWaiter of libraryRefreshWaiters) resolveWaiter();
      libraryRefreshWaiters = [];
      if (refreshHandle !== null) cancelSchedule(refreshHandle);
      if (searchHandle !== null) cancelSchedule(searchHandle);
      exportUi?.destroy();
    },
  };
}
