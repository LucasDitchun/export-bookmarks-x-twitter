export interface PopupElements {
  alert: HTMLElement;
  captureButton: HTMLButtonElement;
  captureButtonLabel: HTMLElement;
  captureFeedback: HTMLElement;
  captureModeField: HTMLElement;
  captureModeHelp: HTMLElement;
  captureModeSelect: HTMLSelectElement;
  captureProgress: HTMLElement;
  captureProgressCopy: HTMLElement;
  captureState: HTMLElement;
  clearDialog: HTMLDialogElement;
  confirmClearButton: HTMLButtonElement;
  currentCount: HTMLElement;
  dashboardView: HTMLElement;
  duplicateSummary: HTMLElement;
  emptyNote: HTMLElement;
  fullReviewReminder: HTMLElement;
  lastSync: HTMLElement;
  libraryEmpty: HTMLElement;
  libraryPanel: HTMLElement;
  librarySearch: HTMLInputElement;
  librarySearchButton: HTMLButtonElement;
  librarySearchStatus: HTMLElement;
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
  organizationCounts: HTMLElement;
  organizationTrashCount: HTMLElement;
  organizationTrashEmpty: HTMLElement;
  organizationTrashStatus: HTMLElement;
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
  tagOverviewList: HTMLUListElement;
  trashFolderList: HTMLUListElement;
  trashTagList: HTMLUListElement;
}

function requireElement<T extends HTMLElement>(document: Document, id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing popup element: #${id}`);
  return element as T;
}

export function getPopupElements(document: Document): PopupElements {
  return {
    alert: requireElement(document, "alert"),
    captureButton: requireElement(document, "capture-button"),
    captureButtonLabel: requireElement(document, "capture-button-label"),
    captureFeedback: requireElement(document, "capture-feedback"),
    captureModeField: requireElement(document, "capture-mode-field"),
    captureModeHelp: requireElement(document, "capture-mode-help"),
    captureModeSelect: requireElement(document, "capture-mode"),
    captureProgress: requireElement(document, "capture-progress"),
    captureProgressCopy: requireElement(document, "capture-progress-copy"),
    captureState: requireElement(document, "capture-state"),
    clearDialog: requireElement(document, "clear-dialog"),
    confirmClearButton: requireElement(document, "confirm-clear-button"),
    currentCount: requireElement(document, "current-count"),
    dashboardView: requireElement(document, "dashboard-view"),
    duplicateSummary: requireElement(document, "duplicate-summary"),
    emptyNote: requireElement(document, "empty-note"),
    fullReviewReminder: requireElement(document, "full-review-reminder"),
    lastSync: requireElement(document, "last-sync"),
    libraryEmpty: requireElement(document, "library-empty"),
    libraryPanel: requireElement(document, "library-view-panel"),
    librarySearch: requireElement(document, "library-search"),
    librarySearchButton: requireElement(document, "library-search-button"),
    librarySearchStatus: requireElement(document, "library-search-status"),
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
    organizationCounts: requireElement(document, "organization-counts"),
    organizationTrashCount: requireElement(document, "organization-trash-count"),
    organizationTrashEmpty: requireElement(document, "organization-trash-empty"),
    organizationTrashStatus: requireElement(document, "organization-trash-status"),
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
    tagOverviewList: requireElement(document, "tag-overview-list"),
    trashFolderList: requireElement(document, "trash-folder-list"),
    trashTagList: requireElement(document, "trash-tag-list"),
  };
}
