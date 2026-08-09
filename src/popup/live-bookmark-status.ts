import type { LiveBookmarkContext } from "../shared/protocol";
import type { Translator } from "./i18n";

const MAX_CONTEXT_AGE_MS = 30_000;

export function renderLiveBookmarkStatus(
  element: HTMLElement,
  context: LiveBookmarkContext | null,
  translate: Translator,
  options: { now?: () => Date } = {},
): void {
  const now = options.now?.() ?? new Date();
  const updatedAt = context ? new Date(context.updatedAt) : null;
  const isFresh =
    updatedAt !== null &&
    !Number.isNaN(updatedAt.valueOf()) &&
    Math.abs(now.valueOf() - updatedAt.valueOf()) <= MAX_CONTEXT_AGE_MS;
  if (!context || !isFresh) {
    element.hidden = true;
    element.textContent = "";
    element.dataset.state = "idle";
    return;
  }

  const keys: Record<LiveBookmarkContext["state"], string> = {
    pending: "liveBookmarkPending",
    saved: "liveBookmarkSaved",
    archived: "liveBookmarkArchived",
    cancelled: "liveBookmarkFailed",
  };
  const message = document.createElement("strong");
  const bookmark = document.createElement("span");
  message.textContent = translate(keys[context.state]);
  bookmark.textContent = context.bookmark.text || context.bookmark.url;
  element.replaceChildren(message, bookmark);
  element.dataset.state = context.state;
  element.hidden = false;
}
