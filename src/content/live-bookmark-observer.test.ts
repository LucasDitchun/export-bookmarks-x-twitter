// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BookmarkRecord } from "../domain/types";
import type { ContentEvent, RuntimeResponse, UiRequest } from "../shared/protocol";
import { startLiveBookmarkObserver } from "./live-bookmark-observer";

function renderTweet(action: "bookmark" | "removeBookmark" = "bookmark") {
  document.body.innerHTML = `
    <main>
      <article data-testid="tweet">
        <div data-testid="User-Name"><a href="/alice"><span>Alice</span></a></div>
        <a href="/alice/status/123"><time datetime="2026-08-09T09:00:00.000Z"></time></a>
        <div data-testid="tweetText">A useful post</div>
        <div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/live?format=jpg&amp;name=large"></div>
        <button type="button" data-testid="${action}" aria-pressed="${action === "removeBookmark"}">
          Bookmark
        </button>
      </article>
    </main>`;
  return document.querySelector<HTMLButtonElement>("button")!;
}

async function settleMutation(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("startLiveBookmarkObserver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not block X and commits only after the saved state is stable", async () => {
    const button = renderTweet();
    const events: ContentEvent[] = [];
    const send = vi.fn(
      async (event: ContentEvent | UiRequest): Promise<RuntimeResponse<unknown>> => {
        if (event.type.startsWith("LIVE_")) events.push(event as ContentEvent);
        if (event.type === "LIVE_BOOKMARK_PENDING") {
          return {
            ok: true,
            data: { prompt: true, surface: "modal", opened: false },
          };
        }
        if (event.type === "LIVE_BOOKMARK_CONFIRMED") {
          return {
            ok: true,
            data: {
              bookmark: {
                id: "123",
                text: "A useful post",
                url: "https://x.com/alice/status/123",
                author: { id: "alice", username: "alice", name: "Alice" },
                postCreatedAt: "2026-08-09T09:00:00.000Z",
                media: {
                  images: ["https://pbs.twimg.com/media/live?format=jpg&name=large"],
                  videos: [],
                },
                note: "",
                folderId: null,
                tagIds: [],
                firstSavedAt: "2026-08-09T09:00:01.000Z",
                lastSeenAt: "2026-08-09T09:00:01.000Z",
                archivedAt: null,
                metadataUpdatedAt: "2026-08-09T09:00:01.000Z",
                status: "current",
              },
            },
          };
        }
        if (event.type === "LIST_TAGS") return { ok: true, data: { tags: [] } };
        if (event.type === "LIST_FOLDERS") {
          return { ok: true, data: { folders: [] } };
        }
        return { ok: true, data: null };
      },
    );
    const onPending = vi.fn();
    const onChanged = vi.fn();
    const observer = startLiveBookmarkObserver({
      document,
      stableForMs: 40,
      timeoutMs: 500,
      send,
      translate: (key) => key,
      onPending,
      onChanged,
    });

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    expect(button.dispatchEvent(click)).toBe(true);
    expect(click.defaultPrevented).toBe(false);
    await settleMutation();
    expect(events[0]).toMatchObject({
      type: "LIVE_BOOKMARK_PENDING",
      action: "save",
      bookmark: { id: "123", text: "A useful post" },
    });
    expect(onPending).toHaveBeenCalledWith(
      button.closest('article[data-testid="tweet"]'),
      "123",
    );
    expect(document.querySelector<HTMLElement>("bookmark-x-note-modal")?.hidden).toBe(
      false,
    );
    expect(events.some(({ type }) => type === "LIVE_BOOKMARK_CONFIRMED")).toBe(false);

    button.dataset.testid = "removeBookmark";
    button.setAttribute("aria-pressed", "true");
    await settleMutation();
    await vi.advanceTimersByTimeAsync(39);
    expect(events.some(({ type }) => type === "LIVE_BOOKMARK_CONFIRMED")).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const confirmed = events.find((event) => event.type === "LIVE_BOOKMARK_CONFIRMED");
    expect(confirmed?.type).toBe("LIVE_BOOKMARK_CONFIRMED");
    if (confirmed?.type === "LIVE_BOOKMARK_CONFIRMED") {
      expect(confirmed.action).toBe("save");
      expect(confirmed.bookmark.id).toBe("123");
      expect(confirmed.bookmark.media?.images).toEqual([
        "https://pbs.twimg.com/media/live?format=jpg&name=large",
      ]);
    }
    const modal = document.querySelector("bookmark-x-note-modal")?.shadowRoot;
    expect(modal?.querySelector('[role="status"]')?.textContent).toBe(
      "liveBookmarkSaved",
    );
    expect(modal?.querySelector("form")?.hidden).toBe(false);
    expect(onChanged).toHaveBeenCalledWith("123");
    observer.stop();
  });

  it("keeps tracking the X action when the metadata modal is dismissed", async () => {
    const button = renderTweet();
    const events: ContentEvent[] = [];
    const send = vi.fn(
      async (event: ContentEvent | UiRequest): Promise<RuntimeResponse<unknown>> => {
        if (event.type.startsWith("LIVE_")) events.push(event as ContentEvent);
        if (event.type === "LIVE_BOOKMARK_PENDING") {
          return {
            ok: true,
            data: { prompt: true, surface: "modal", opened: false },
          };
        }
        return { ok: true, data: null };
      },
    );
    const observer = startLiveBookmarkObserver({
      document,
      stableForMs: 40,
      timeoutMs: 500,
      send,
      translate: (key) => key,
    });

    button.click();
    await settleMutation();
    button.dataset.testid = "removeBookmark";
    button.setAttribute("aria-pressed", "true");
    await settleMutation();
    document
      .querySelector("bookmark-x-note-modal")
      ?.shadowRoot?.querySelector<HTMLButtonElement>("button.close")
      ?.click();
    await vi.advanceTimersByTimeAsync(40);
    await settleMutation();

    observer.stop();
    expect(events.some(({ type }) => type === "LIVE_BOOKMARK_CONFIRMED")).toBe(true);
    expect(events.some(({ type }) => type === "LIVE_BOOKMARK_CANCELLED")).toBe(false);
  });

  it("uses the manually selected locale when opening the automatic modal", async () => {
    const button = renderTweet();
    const send = vi.fn(
      async (event: ContentEvent | UiRequest): Promise<RuntimeResponse<unknown>> => {
        if (event.type === "LIVE_BOOKMARK_PENDING") {
          return {
            ok: true,
            data: {
              prompt: true,
              surface: "modal",
              opened: false,
              localization: {
                locale: "pt_BR",
                messages: {
                  bookmarkPromptTitle: "Por que você está salvando isto?",
                  bookmarkPromptClose: "Fechar",
                  bookmarkPromptNote: "Nota privada",
                  bookmarkPromptFolder: "Pasta",
                  bookmarkPromptSave: "Salvar nota",
                  bookmarkPromptTags: "Tags",
                  bookmarkPromptTagsHelp: "Separe várias tags com vírgulas.",
                  liveBookmarkPending: "Salvando…",
                },
              },
            },
          };
        }
        return { ok: true, data: null };
      },
    );
    const observer = startLiveBookmarkObserver({
      document,
      stableForMs: 40,
      timeoutMs: 500,
      send,
      translate: (key) => `chrome:${key}`,
    });

    button.click();
    await settleMutation();

    const title = document
      .querySelector("bookmark-x-note-modal")
      ?.shadowRoot?.querySelector("h2")?.textContent;
    observer.stop();
    expect(title).toBe("Por que você está salvando isto?");
  });

  it("relocalizes an already open automatic modal without clearing its note", async () => {
    const button = renderTweet();
    const observer = startLiveBookmarkObserver({
      document,
      stableForMs: 40,
      timeoutMs: 500,
      send: async (event): Promise<RuntimeResponse<unknown>> =>
        event.type === "LIVE_BOOKMARK_PENDING"
          ? {
              ok: true,
              data: {
                prompt: true,
                surface: "modal",
                opened: false,
                localization: {
                  locale: "en",
                  messages: {
                    bookmarkPromptTitle: "Why are you saving this?",
                    bookmarkPromptClose: "Close",
                    bookmarkPromptNote: "Private note",
                    bookmarkPromptFolder: "Folder",
                    bookmarkPromptSave: "Save note",
                    bookmarkPromptTags: "Tags",
                    bookmarkPromptTagsHelp: "Separate tags with commas.",
                    liveBookmarkPending: "Saving…",
                  },
                },
              },
            }
          : { ok: true, data: null },
      translate: (key) => key,
    });

    button.click();
    await settleMutation();
    const modal = document.querySelector("bookmark-x-note-modal")?.shadowRoot;
    const note = modal?.querySelector<HTMLTextAreaElement>(
      "#bookmark-x-modal-description",
    );
    if (!note) throw new Error("Missing active modal note");
    note.value = "Keep this draft";

    observer.setLocalization({
      locale: "pt_BR",
      messages: {
        bookmarkPromptTitle: "Por que você está salvando isto?",
        bookmarkPromptClose: "Fechar",
        bookmarkPromptNote: "Nota privada",
        bookmarkPromptFolder: "Pasta",
        bookmarkPromptSave: "Salvar nota",
        bookmarkPromptTags: "Tags",
        bookmarkPromptTagsHelp: "Separe tags com vírgulas.",
        liveBookmarkPending: "Salvando…",
      },
    });

    expect(modal?.querySelector("h2")?.textContent).toBe(
      "Por que você está salvando isto?",
    );
    expect(note.value).toBe("Keep this draft");
    observer.stop();
  });

  it("persists modal note, tags, and folder after X confirms the bookmark", async () => {
    const button = renderTweet();
    const metadataRequests: UiRequest[] = [];
    const record: BookmarkRecord = {
      id: "123",
      text: "A useful post",
      url: "https://x.com/alice/status/123",
      author: { id: "alice", username: "alice", name: "Alice" },
      postCreatedAt: "2026-08-09T09:00:00.000Z",
      media: { images: [], videos: [] },
      note: "Existing note",
      folderId: "folder-reading",
      tagIds: ["tag-existing"],
      firstSavedAt: "2026-08-09T09:00:01.000Z",
      lastSeenAt: "2026-08-09T09:00:01.000Z",
      archivedAt: null,
      metadataUpdatedAt: "2026-08-09T09:00:01.000Z",
      status: "current",
    };
    const send = vi.fn(
      async (message: ContentEvent | UiRequest): Promise<RuntimeResponse<unknown>> => {
        if (message.type === "LIVE_BOOKMARK_PENDING") {
          return {
            ok: true,
            data: { prompt: true, surface: "modal", opened: false },
          };
        }
        if (message.type === "LIVE_BOOKMARK_CONFIRMED") {
          return { ok: true, data: { bookmark: record } };
        }
        if (!message.type.startsWith("LIVE_"))
          metadataRequests.push(message as UiRequest);
        if (message.type === "LIST_TAGS") {
          return {
            ok: true,
            data: {
              tags: [{ id: "tag-existing", name: "AI, ML", normalizedName: "ai, ml" }],
            },
          };
        }
        if (message.type === "LIST_FOLDERS") {
          return {
            ok: true,
            data: {
              folders: [{ id: "folder-reading", name: "R&D/Video", parentId: null }],
            },
          };
        }
        if (message.type === "CREATE_FOLDER") {
          return {
            ok: true,
            data: {
              folder: {
                id: "folder-ai",
                name: message.payload.name,
                parentId: message.payload.parentId,
              },
            },
          };
        }
        return { ok: true, data: { bookmark: record } };
      },
    );
    const observer = startLiveBookmarkObserver({
      document,
      stableForMs: 20,
      timeoutMs: 200,
      send,
      translate: (key) => key,
    });

    button.click();
    await settleMutation();
    button.dataset.testid = "removeBookmark";
    button.setAttribute("aria-pressed", "true");
    await settleMutation();
    await vi.advanceTimersByTimeAsync(20);
    await settleMutation();

    const shadow = document.querySelector("bookmark-x-note-modal")?.shadowRoot;
    const tags = shadow?.querySelector<HTMLInputElement>("#bookmark-x-modal-tags");
    const folder = shadow?.querySelector<HTMLInputElement>("#bookmark-x-modal-folder");
    const description = shadow?.querySelector<HTMLTextAreaElement>(
      "#bookmark-x-modal-description",
    );
    expect(tags?.value).toBe("");
    expect(shadow?.querySelector(".token")?.textContent).toContain("AI, ML");
    expect(folder?.value).toBe("");
    expect(shadow?.querySelector(".folder-token")?.textContent).toContain("R&D/Video");
    expect(description?.value).toBe("Existing note");

    tags!.value = "New, exact";
    tags!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    description!.value = "Why this matters";
    shadow
      ?.querySelector("form")
      ?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() => {
      expect(metadataRequests).toContainEqual({
        type: "SAVE_BOOKMARK_METADATA",
        payload: {
          id: "123",
          note: "Why this matters",
          tags: [
            { id: "tag-existing", name: "AI, ML" },
            { id: null, name: "New, exact" },
          ],
          folder: { id: "folder-reading", path: ["R&D/Video"] },
        },
      });
    });
    observer.stop();
  });

  it("cancels a failed or reversed X update without committing locally", async () => {
    const button = renderTweet();
    const events: ContentEvent[] = [];
    const send = vi.fn(
      async (event: ContentEvent | UiRequest): Promise<RuntimeResponse<unknown>> => {
        if (event.type.startsWith("LIVE_")) events.push(event as ContentEvent);
        return event.type === "LIVE_BOOKMARK_PENDING"
          ? {
              ok: true,
              data: { prompt: true, surface: "modal", opened: false },
            }
          : { ok: true, data: null };
      },
    );
    const observer = startLiveBookmarkObserver({
      document,
      stableForMs: 50,
      timeoutMs: 120,
      send,
      translate: (key) => key,
    });

    button.click();
    await settleMutation();
    button.dataset.testid = "removeBookmark";
    button.setAttribute("aria-pressed", "true");
    await settleMutation();
    await vi.advanceTimersByTimeAsync(25);
    button.dataset.testid = "bookmark";
    button.setAttribute("aria-pressed", "false");
    await settleMutation();
    await vi.advanceTimersByTimeAsync(120);

    expect(events.some(({ type }) => type === "LIVE_BOOKMARK_CONFIRMED")).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "LIVE_BOOKMARK_CANCELLED" }),
    );
    expect(
      document
        .querySelector("bookmark-x-note-modal")
        ?.shadowRoot?.querySelector('[role="status"]')?.textContent,
    ).toBe("liveBookmarkFailed");
    observer.stop();
  });

  it("confirms an unbookmark only after X renders the unbookmarked state", async () => {
    const button = renderTweet("removeBookmark");
    const events: ContentEvent[] = [];
    const send = vi.fn(
      async (event: ContentEvent | UiRequest): Promise<RuntimeResponse<unknown>> => {
        if (event.type.startsWith("LIVE_")) events.push(event as ContentEvent);
        return event.type === "LIVE_BOOKMARK_PENDING"
          ? {
              ok: true,
              data: { prompt: false, surface: "modal", opened: false },
            }
          : { ok: true, data: null };
      },
    );
    const observer = startLiveBookmarkObserver({
      document,
      stableForMs: 20,
      timeoutMs: 200,
      send,
      translate: (key) => key,
    });

    button.click();
    await settleMutation();
    expect(document.querySelector("bookmark-x-note-modal")).toBeNull();
    button.dataset.testid = "bookmark";
    button.setAttribute("aria-pressed", "false");
    await settleMutation();
    await vi.advanceTimersByTimeAsync(20);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "LIVE_BOOKMARK_CONFIRMED",
        action: "remove",
      }),
    );
    observer.stop();
  });
});
