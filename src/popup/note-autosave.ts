import type { BookmarkDetailResult, NotedBookmark, SendMessage } from "./protocol";

type NoteSaveStatus = "noteSaving" | "noteSaved" | "noteSaveError" | null;

interface VisibleDraft {
  id: string;
  note: string;
}

interface PendingNoteSave extends VisibleDraft {
  revision: number;
}

interface NoteAutosaveOptions {
  sendMessage: SendMessage;
  schedule: typeof window.setTimeout;
  cancelSchedule: typeof window.clearTimeout;
  getVisibleDraft(): VisibleDraft | null;
  onSaved(bookmark: NotedBookmark): void;
  onStatus(status: NoteSaveStatus): void;
}

export interface NoteAutosaveController {
  select(bookmarkId: string | null, discardDraft?: boolean): void;
  stage(note: string): void;
  flush(): void;
  destroy(): void;
}

export function createNoteAutosave(
  options: NoteAutosaveOptions,
): NoteAutosaveController {
  let selectedBookmarkId: string | null = null;
  let editRevision = 0;
  let saveHandle: number | null = null;
  let debounced: PendingNoteSave | null = null;
  let pending: PendingNoteSave | null = null;
  let saving = false;
  let destroyed = false;

  const drain = async (): Promise<void> => {
    if (destroyed || saving || !pending) return;
    const save = pending;
    pending = null;
    saving = true;
    try {
      const response = await options.sendMessage<BookmarkDetailResult>({
        type: "SAVE_BOOKMARK_NOTE",
        payload: { id: save.id, note: save.note },
      });
      const visible = options.getVisibleDraft();
      const latest =
        visible?.id === save.id &&
        visible.note === save.note &&
        selectedBookmarkId === save.id &&
        editRevision === save.revision &&
        !pending &&
        !debounced;
      if (latest) {
        if (response.ok && response.data?.bookmark)
          options.onSaved(response.data.bookmark);
        options.onStatus(response.ok ? "noteSaved" : "noteSaveError");
      }
    } catch {
      if (
        selectedBookmarkId === save.id &&
        editRevision === save.revision &&
        !pending &&
        !debounced
      ) {
        options.onStatus("noteSaveError");
      }
    } finally {
      saving = false;
      if (pending) void drain();
    }
  };

  const flush = (): void => {
    if (!debounced) return;
    if (saveHandle !== null) options.cancelSchedule(saveHandle);
    saveHandle = null;
    pending = debounced;
    debounced = null;
    void drain();
  };

  return {
    select(bookmarkId, discardDraft = false) {
      if (!discardDraft) flush();
      selectedBookmarkId = bookmarkId;
      editRevision += 1;
      if (saveHandle !== null) options.cancelSchedule(saveHandle);
      saveHandle = null;
      debounced = null;
      if (discardDraft) pending = null;
    },
    stage(note) {
      if (!selectedBookmarkId || destroyed) return;
      debounced = { id: selectedBookmarkId, note, revision: ++editRevision };
      options.onStatus("noteSaving");
      if (saveHandle !== null) options.cancelSchedule(saveHandle);
      saveHandle = options.schedule(() => {
        saveHandle = null;
        flush();
      }, 400);
    },
    flush,
    destroy() {
      if (destroyed) return;
      const latest = debounced ?? pending;
      if (saveHandle !== null) options.cancelSchedule(saveHandle);
      saveHandle = null;
      debounced = null;
      pending = null;
      destroyed = true;
      if (latest) {
        void options
          .sendMessage<BookmarkDetailResult>({
            type: "SAVE_BOOKMARK_NOTE",
            payload: { id: latest.id, note: latest.note },
          })
          .catch(() => undefined);
      }
    },
  };
}
