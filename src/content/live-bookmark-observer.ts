import type { BookmarkRecord, BookmarkSnapshot } from "../domain/types";
import type {
  BookmarkLocalizationResult,
  ContentEvent,
  LiveBookmarkAction,
  LiveBookmarkIntentResult,
  RuntimeResponse,
  UiRequest,
} from "../shared/protocol";
import {
  createBookmarkModal,
  type BookmarkModalController,
} from "../surfaces/bookmark-modal";
import { extractBookmarks } from "./extract-bookmarks";
import { loadBookmarkMetadataDraft, saveBookmarkMetadata } from "./bookmark-metadata";
import { isContentBookmarkMedia } from "./bookmark-media";
import type { BookmarkMetadataTranslator } from "../shared/bookmark-metadata-messages";

const DEFAULT_STABLE_FOR_MS = 900;
const DEFAULT_TIMEOUT_MS = 6_000;

export interface LiveBookmarkObserverOptions {
  document: Document;
  send: (event: ContentEvent | UiRequest) => Promise<RuntimeResponse<unknown>>;
  translate: BookmarkMetadataTranslator;
  stableForMs?: number;
  timeoutMs?: number;
  onPending?: (article: Element, bookmarkId: string) => void;
  onChanged?: (bookmarkId: string) => void;
}

export interface LiveBookmarkObserverController {
  setLocalization(localization: BookmarkLocalizationResult): void;
  stop(): void;
}

interface ActiveIntent {
  controller: AbortController;
  intentId: string;
  metadataController: AbortController | null;
  modal: BookmarkModalController | null;
  prepareMetadata?: (bookmark: BookmarkRecord) => Promise<void>;
  setLocalization?: (localization: BookmarkLocalizationResult) => void;
}

function isBookmarkRecord(value: unknown): value is BookmarkRecord {
  if (typeof value !== "object" || value === null) return false;
  const bookmark = value as Partial<BookmarkRecord>;
  return (
    typeof bookmark.id === "string" &&
    typeof bookmark.text === "string" &&
    typeof bookmark.url === "string" &&
    typeof bookmark.author === "object" &&
    bookmark.author !== null &&
    typeof bookmark.author.id === "string" &&
    typeof bookmark.author.username === "string" &&
    typeof bookmark.author.name === "string" &&
    typeof bookmark.postCreatedAt === "string" &&
    isContentBookmarkMedia(bookmark.media, bookmark.url) &&
    typeof bookmark.note === "string" &&
    (bookmark.folderId === null || typeof bookmark.folderId === "string") &&
    Array.isArray(bookmark.tagIds) &&
    bookmark.tagIds.every((tagId) => typeof tagId === "string") &&
    typeof bookmark.firstSavedAt === "string" &&
    typeof bookmark.lastSeenAt === "string" &&
    (bookmark.archivedAt === null || typeof bookmark.archivedAt === "string") &&
    typeof bookmark.metadataUpdatedAt === "string" &&
    (bookmark.status === "current" || bookmark.status === "archived")
  );
}

function isBookmarkButton(button: HTMLButtonElement): LiveBookmarkAction | null {
  if (button.dataset.testid === "bookmark") return "save";
  if (button.dataset.testid === "removeBookmark") return "remove";
  return null;
}

function actionIsRendered(article: Element, action: LiveBookmarkAction): boolean {
  const button = article.querySelector<HTMLButtonElement>(
    'button[data-testid="bookmark"], button[data-testid="removeBookmark"]',
  );
  if (!button) return false;
  if (action === "save") {
    return (
      button.dataset.testid === "removeBookmark" ||
      button.getAttribute("aria-pressed") === "true"
    );
  }
  return (
    button.dataset.testid === "bookmark" ||
    button.getAttribute("aria-pressed") === "false"
  );
}

function waitForStableAction(options: {
  document: Document;
  article: Element;
  action: LiveBookmarkAction;
  signal: AbortSignal;
  stableForMs: number;
  timeoutMs: number;
}): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let stableTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = (confirmed: boolean): void => {
      if (settled) return;
      settled = true;
      mutationObserver.disconnect();
      if (stableTimer !== null) clearTimeout(stableTimer);
      clearTimeout(timeoutTimer);
      options.signal.removeEventListener("abort", onAbort);
      resolve(confirmed);
    };
    const inspect = (): void => {
      if (actionIsRendered(options.article, options.action)) {
        stableTimer ??= setTimeout(() => finish(true), options.stableForMs);
      } else if (stableTimer !== null) {
        clearTimeout(stableTimer);
        stableTimer = null;
      }
    };
    const mutationObserver = new MutationObserver(inspect);
    const timeoutTimer = setTimeout(() => finish(false), options.timeoutMs);
    const onAbort = (): void => finish(false);
    options.signal.addEventListener("abort", onAbort, { once: true });
    mutationObserver.observe(options.document.documentElement, {
      attributes: true,
      attributeFilter: ["aria-pressed", "data-testid"],
      childList: true,
      subtree: true,
    });
    inspect();
  });
}

function randomIntentId(): string {
  return crypto.randomUUID();
}

function modalLabels(translate: BookmarkMetadataTranslator) {
  return {
    close: translate("bookmarkPromptClose"),
    description: translate("bookmarkPromptNote"),
    folder: translate("bookmarkPromptFolder"),
    save: translate("bookmarkPromptSave"),
    tags: translate("bookmarkPromptTags"),
    tagsHelp: translate("bookmarkPromptTagsHelp"),
    pending: translate("liveBookmarkPending"),
  };
}

function selectedLocaleTranslator(
  localization: Partial<BookmarkLocalizationResult> | undefined,
  fallback: BookmarkMetadataTranslator,
): BookmarkMetadataTranslator {
  if (
    !localization ||
    typeof localization.messages !== "object" ||
    localization.messages === null
  ) {
    return fallback;
  }
  return (key) => localization.messages?.[key] ?? fallback(key);
}

export function startLiveBookmarkObserver(
  options: LiveBookmarkObserverOptions,
): LiveBookmarkObserverController {
  const activeByBookmark = new Map<string, ActiveIntent>();
  const modalByBookmark = new Map<string, ActiveIntent>();
  let stopped = false;

  const runIntent = async (
    action: LiveBookmarkAction,
    bookmark: BookmarkSnapshot,
    article: Element,
  ): Promise<void> => {
    const previous = activeByBookmark.get(bookmark.id);
    previous?.controller.abort();
    previous?.metadataController?.abort();
    const previousModal = modalByBookmark.get(bookmark.id);
    previousModal?.controller.abort();
    previousModal?.metadataController?.abort();
    previousModal?.modal?.destroy();
    modalByBookmark.delete(bookmark.id);

    const active: ActiveIntent = {
      controller: new AbortController(),
      intentId: randomIntentId(),
      metadataController: null,
      modal: null,
    };
    activeByBookmark.set(bookmark.id, active);
    const pendingEvent: ContentEvent = {
      type: "LIVE_BOOKMARK_PENDING",
      intentId: active.intentId,
      action,
      bookmark,
    };
    options.onPending?.(article, bookmark.id);

    const pendingResponse = options.send(pendingEvent);
    const confirmation = waitForStableAction({
      document: options.document,
      article,
      action,
      signal: active.controller.signal,
      stableForMs: options.stableForMs ?? DEFAULT_STABLE_FOR_MS,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });

    const response = await pendingResponse.catch(() => null);
    const intentResult = response?.ok
      ? (response.data as LiveBookmarkIntentResult)
      : null;
    let translate = options.translate;
    let modalState: Parameters<BookmarkModalController["setState"]>[0] = "pending";
    let modalMessageKey = "liveBookmarkPending";
    const setTranslatedState = (
      state: Parameters<BookmarkModalController["setState"]>[0],
      messageKey: string,
    ): void => {
      modalState = state;
      modalMessageKey = messageKey;
      active.modal?.setState(state, translate(messageKey));
    };
    if (
      !stopped &&
      !active.controller.signal.aborted &&
      intentResult?.prompt &&
      intentResult.surface === "modal"
    ) {
      translate = selectedLocaleTranslator(
        intentResult.localization,
        options.translate,
      );
      let modal: BookmarkModalController | null = null;
      const metadataController = new AbortController();
      active.metadataController = metadataController;
      let savedBookmark: BookmarkRecord | null = null;
      let pendingValues: Parameters<typeof saveBookmarkMetadata>[0]["values"] | null =
        null;
      let saveDrain: Promise<void> | null = null;
      const persistValues = (
        values: Parameters<typeof saveBookmarkMetadata>[0]["values"],
      ): Promise<void> => {
        pendingValues = values;
        saveDrain ??= Promise.resolve()
          .then(async () => {
            while (pendingValues) {
              const latest = pendingValues;
              pendingValues = null;
              if (!savedBookmark) throw new Error("Bookmark metadata is not ready.");
              await saveBookmarkMetadata({
                bookmark: savedBookmark,
                values: latest,
                send: options.send,
                signal: metadataController.signal,
              });
            }
          })
          .finally(() => {
            saveDrain = null;
          });
        return saveDrain;
      };
      modal = createBookmarkModal({
        document: options.document,
        title: translate("bookmarkPromptTitle"),
        bookmarkTitle: bookmark.text || bookmark.url,
        labels: modalLabels(translate),
        onSave: async (values) => {
          setTranslatedState("pending", "liveBookmarkPending");
          try {
            await persistValues(values);
            options.onChanged?.(bookmark.id);
            setTranslatedState("ready", "liveBookmarkSaved");
            return true;
          } catch {
            if (!metadataController.signal.aborted) {
              setTranslatedState("ready", "liveBookmarkFailed");
            }
            return false;
          }
        },
        onClose: () => {
          if (modal && modalByBookmark.get(bookmark.id) === active) {
            modalByBookmark.delete(bookmark.id);
            active.metadataController?.abort();
            active.metadataController = null;
            active.modal = null;
            delete active.prepareMetadata;
            delete active.setLocalization;
            modal.destroy();
            modal = null;
          }
        },
      });
      active.modal = modal;
      active.setLocalization = (localization) => {
        translate = selectedLocaleTranslator(localization, options.translate);
        modal?.setLabels({
          title: translate("bookmarkPromptTitle"),
          labels: modalLabels(translate),
        });
        modal?.setState(modalState, translate(modalMessageKey));
      };
      modalByBookmark.set(bookmark.id, active);
      modal.open();

      active.prepareMetadata = async (record) => {
        savedBookmark = record;
        const { values, choices } = await loadBookmarkMetadataDraft({
          bookmark: record,
          send: options.send,
          signal: metadataController.signal,
        });
        if (!metadataController.signal.aborted) {
          modal?.setValues(values);
          modal?.setChoices(choices);
        }
      };
    }

    const confirmed = await confirmation;
    if (stopped || activeByBookmark.get(bookmark.id) !== active) return;
    if (!confirmed) {
      await options
        .send({ type: "LIVE_BOOKMARK_CANCELLED", intentId: active.intentId })
        .catch(() => undefined);
      setTranslatedState("error", "liveBookmarkFailed");
      options.onChanged?.(bookmark.id);
      activeByBookmark.delete(bookmark.id);
      return;
    }

    const committed = await options
      .send({
        type: "LIVE_BOOKMARK_CONFIRMED",
        intentId: active.intentId,
        action,
        bookmark,
      })
      .catch(() => null);
    if (committed?.ok) {
      if (action === "save") {
        const record = (committed.data as { bookmark?: unknown } | null)?.bookmark;
        try {
          if (active.modal) {
            if (!isBookmarkRecord(record))
              throw new Error("Invalid bookmark response.");
            await active.prepareMetadata?.(record);
          }
          if (!active.controller.signal.aborted) {
            setTranslatedState("ready", "liveBookmarkSaved");
          }
        } catch {
          if (!active.controller.signal.aborted) {
            setTranslatedState("ready", "liveBookmarkFailed");
          }
        }
      } else {
        setTranslatedState("success", "liveBookmarkArchived");
      }
    } else {
      setTranslatedState("error", "liveBookmarkFailed");
    }
    options.onChanged?.(bookmark.id);
    activeByBookmark.delete(bookmark.id);
  };

  const onClick = (event: MouseEvent): void => {
    if (stopped || !(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement>("button");
    if (!button) return;
    const action = isBookmarkButton(button);
    if (!action) return;
    const article = button.closest('article[data-testid="tweet"]');
    if (!article) return;
    const bookmark = extractBookmarks(article)[0];
    if (!bookmark) return;
    // Deliberately do not cancel, stop, or await the X click. Its own handler runs
    // normally while the extension verifies the resulting DOM state independently.
    void runIntent(action, bookmark, article);
  };

  options.document.addEventListener("click", onClick, true);
  return {
    setLocalization(localization) {
      for (const active of new Set(modalByBookmark.values())) {
        active.setLocalization?.(localization);
      }
    },
    stop() {
      if (stopped) return;
      stopped = true;
      options.document.removeEventListener("click", onClick, true);
      for (const active of activeByBookmark.values()) {
        active.controller.abort();
        active.metadataController?.abort();
      }
      for (const active of new Set(modalByBookmark.values())) {
        active.controller.abort();
        active.metadataController?.abort();
        active.modal?.destroy();
      }
      activeByBookmark.clear();
      modalByBookmark.clear();
    },
  };
}
