// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NotedBookmark, PopupStatus, SendMessage } from "./protocol";
import { createPopupApp } from "./app";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

const popupHtml = readFileSync(resolve(process.cwd(), "popup.html"), "utf8");
const translate = (key: string, substitutions?: string | string[]): string => {
  const values = typeof substitutions === "string" ? [substitutions] : substitutions;
  return values?.length ? `${key}:${values.join("|")}` : key;
};

const emptyStatus: PopupStatus = {
  pageReady: false,
  stats: {
    total: 0,
    current: 0,
    archived: 0,
    lastSuccessfulSyncAt: null,
  },
  scrape: null,
  fullReviewDue: false,
  quickUpdateAvailable: false,
};

const readyStatus: PopupStatus = {
  pageReady: true,
  stats: {
    total: 42,
    current: 40,
    archived: 2,
    lastSuccessfulSyncAt: "2026-07-29T10:00:00.000Z",
  },
  scrape: {
    id: "run-1",
    tabId: 7,
    status: "completed",
    fetched: 42,
    added: 40,
    updated: 2,
    startedAt: "2026-07-29T10:00:00.000Z",
    updatedAt: "2026-07-29T10:01:00.000Z",
    errorCode: null,
    mode: "full",
    checkpointIds: [],
    checkpointCandidates: ["123"],
    checkpointMatchIds: [],
    completionReason: "stable_end",
  },
  fullReviewDue: false,
  quickUpdateAvailable: true,
};

const libraryBookmark: NotedBookmark = {
  id: "123",
  text: "A useful bookmark",
  url: "https://x.com/person/status/123",
  author: { id: "person", username: "person", name: "Person" },
  postCreatedAt: "2026-07-29T09:00:00.000Z",
  media: { images: [], videos: [] },
  folderId: null,
  tagIds: [],
  firstSavedAt: "2026-07-29T10:00:00.000Z",
  lastSeenAt: "2026-07-29T10:00:00.000Z",
  archivedAt: null,
  metadataUpdatedAt: "2026-07-29T10:00:00.000Z",
  status: "current",
  note: "Read this again",
};

beforeEach(() => {
  document.open();
  document.write(popupHtml);
  document.close();
});

describe("popup app", () => {
  it("fuses optional semantic results and keeps lexical search on model failure", async () => {
    const callbacks: Array<() => void> = [];
    const schedule = ((callback: () => void, delay: number) => {
      if (delay === 150) callbacks.push(callback);
      return callbacks.length;
    }) as typeof window.setTimeout;
    const lexical = { ...libraryBookmark, id: "701", text: "Exact lexical result" };
    const remembered = {
      ...libraryBookmark,
      id: "702",
      text: "Conceptually related result",
    };
    const sendMessage = ((request) => {
      if (request.type === "GET_STATUS") {
        return Promise.resolve({ ok: true as const, data: readyStatus });
      }
      if (request.type === "LIST_BOOKMARKS") {
        return Promise.resolve({
          ok: true as const,
          data: { items: [libraryBookmark], nextCursor: null },
        });
      }
      if (request.type === "SEARCH_BOOKMARKS") {
        return Promise.resolve({
          ok: true as const,
          data: { items: [lexical], total: 1, nextCursor: null },
        });
      }
      if (request.type === "GET_BOOKMARK") {
        return Promise.resolve({ ok: true as const, data: { bookmark: lexical } });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const semanticSearch = vi
      .fn()
      .mockResolvedValueOnce([remembered])
      .mockRejectedValueOnce(new Error("offline"));
    const app = createPopupApp({
      document,
      locale: "en",
      sendMessage,
      translate,
      schedule,
      cancelSchedule: vi.fn(),
      semanticSearch,
    });
    await app.ready;
    const input = document.getElementById("library-search") as HTMLInputElement;

    input.value = "something I remember";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    callbacks.shift()?.();
    await vi.waitFor(() =>
      expect(document.getElementById("bookmark-list")?.textContent).toContain(
        "Conceptually related result",
      ),
    );
    expect(document.getElementById("bookmark-list")?.textContent).toContain(
      "Exact lexical result",
    );

    input.value = "offline query";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    callbacks.shift()?.();
    await vi.waitFor(() =>
      expect(document.getElementById("bookmark-list")?.textContent).toContain(
        "Exact lexical result",
      ),
    );
    expect(semanticSearch).toHaveBeenCalledTimes(2);
    app.destroy();
  });

  it("filters the active view while typing and clears back to its paginated list", async () => {
    const scheduled: Array<{ callback: () => void; delay: number }> = [];
    const schedule = ((callback: () => void, delay: number) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    }) as typeof window.setTimeout;
    const searchBookmark = {
      ...libraryBookmark,
      id: "999",
      text: '<img src=x onerror="alert(1)"> Café',
    };
    const requests: Array<{ type: string; payload?: unknown }> = [];
    let listCalls = 0;
    const sendMessage = ((request) => {
      requests.push(request);
      if (request.type === "GET_STATUS") {
        return Promise.resolve({ ok: true as const, data: readyStatus });
      }
      if (request.type === "LIST_BOOKMARKS") {
        listCalls += 1;
        return Promise.resolve({
          ok: true as const,
          data: { items: [libraryBookmark], nextCursor: "page-2" },
        });
      }
      if (request.type === "SEARCH_BOOKMARKS") {
        return Promise.resolve({
          ok: true as const,
          data: { items: [searchBookmark], total: 1, nextCursor: null },
        });
      }
      if (request.type === "GET_BOOKMARK") {
        const id = request.payload.id;
        return Promise.resolve({
          ok: true as const,
          data: { bookmark: id === "999" ? searchBookmark : libraryBookmark },
        });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const app = createPopupApp({
      document,
      locale: "en",
      sendMessage,
      translate,
      schedule,
      cancelSchedule: vi.fn(),
    });
    await app.ready;

    const input = document.getElementById("library-search") as HTMLInputElement;
    input.value = "cafe";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    scheduled.find(({ delay }) => delay === 150)?.callback();
    await vi.waitFor(() =>
      expect(requests).toContainEqual({
        type: "SEARCH_BOOKMARKS",
        payload: { query: "cafe", view: "inbox" },
      }),
    );
    expect(document.getElementById("bookmark-list")?.textContent).toContain(
      '<img src=x onerror="alert(1)"> Café',
    );
    expect(document.querySelector("#bookmark-list img")).toBeNull();
    expect(document.getElementById("library-search-status")?.textContent).toBe(
      "searchResultsCount:1",
    );

    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(listCalls).toBe(2));
    expect(document.getElementById("bookmark-list")?.textContent).toContain(
      "A useful bookmark",
    );
    expect(document.getElementById("load-more-bookmarks")?.hidden).toBe(false);
    app.destroy();
  });

  it("keeps the newest typed query when an older search resolves later", async () => {
    const firstSearch = deferred<{
      ok: true;
      data: { items: NotedBookmark[]; total: number; nextCursor: null };
    }>();
    const callbacks: Array<() => void> = [];
    const schedule = ((callback: () => void, delay: number) => {
      if (delay === 150) callbacks.push(callback);
      return callbacks.length;
    }) as typeof window.setTimeout;
    const newerBookmark = { ...libraryBookmark, id: "456", text: "Newer result" };
    const sendMessage = ((request) => {
      if (request.type === "GET_STATUS") {
        return Promise.resolve({ ok: true as const, data: readyStatus });
      }
      if (request.type === "LIST_BOOKMARKS") {
        return Promise.resolve({
          ok: true as const,
          data: { items: [libraryBookmark], nextCursor: null },
        });
      }
      if (request.type === "SEARCH_BOOKMARKS") {
        return request.payload.query === "old"
          ? firstSearch.promise
          : Promise.resolve({
              ok: true as const,
              data: { items: [newerBookmark], total: 1, nextCursor: null },
            });
      }
      if (request.type === "GET_BOOKMARK") {
        return Promise.resolve({
          ok: true as const,
          data: { bookmark: libraryBookmark },
        });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const app = createPopupApp({
      document,
      locale: "en",
      sendMessage,
      translate,
      schedule,
      cancelSchedule: vi.fn(),
    });
    await app.ready;
    const input = document.getElementById("library-search") as HTMLInputElement;

    input.value = "old";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    callbacks.shift()?.();
    input.value = "new";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    callbacks.shift()?.();
    await vi.waitFor(() =>
      expect(document.getElementById("bookmark-list")?.textContent).toContain(
        "Newer result",
      ),
    );

    firstSearch.resolve({
      ok: true,
      data: { items: [libraryBookmark], total: 1, nextCursor: null },
    });
    await firstSearch.promise;
    await Promise.resolve();
    expect(document.getElementById("bookmark-list")?.textContent).toContain(
      "Newer result",
    );
    expect(document.getElementById("bookmark-list")?.textContent).not.toContain(
      "A useful bookmark",
    );
    app.destroy();
  });

  it("waits for Enter or the Search button when filtering as you type is off", async () => {
    const searchQueries: string[] = [];
    const scheduledDelays: number[] = [];
    const schedule = ((_callback: () => void, delay: number) => {
      scheduledDelays.push(delay);
      return scheduledDelays.length;
    }) as typeof window.setTimeout;
    const sendMessage = ((request) => {
      if (request.type === "GET_STATUS") {
        return Promise.resolve({ ok: true as const, data: readyStatus });
      }
      if (request.type === "LIST_BOOKMARKS") {
        return Promise.resolve({
          ok: true as const,
          data: { items: [libraryBookmark], nextCursor: null },
        });
      }
      if (request.type === "SEARCH_BOOKMARKS") {
        searchQueries.push(request.payload.query);
        return Promise.resolve({
          ok: true as const,
          data: { items: [], total: 0, nextCursor: null },
        });
      }
      if (request.type === "GET_BOOKMARK") {
        return Promise.resolve({
          ok: true as const,
          data: { bookmark: libraryBookmark },
        });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const app = createPopupApp({
      document,
      locale: "en",
      sendMessage,
      translate,
      schedule,
      cancelSchedule: vi.fn(),
      filterAsYouType: false,
    });
    await app.ready;
    const input = document.getElementById("library-search") as HTMLInputElement;

    input.value = "notes";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
    expect(searchQueries).toEqual([]);
    expect(scheduledDelays).not.toContain(150);
    expect(document.getElementById("library-search-status")?.textContent).toBe(
      "searchReady",
    );

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(searchQueries).toEqual(["notes"]));

    input.value = "folders";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("library-search-button")?.click();
    await vi.waitFor(() => expect(searchQueries).toEqual(["notes", "folders"]));
    app.destroy();
  });

  it("shows and selects a newly completed live bookmark after an initially empty list", async () => {
    const newBookmark = {
      ...libraryBookmark,
      id: "456",
      text: "New live bookmark",
      url: "https://x.com/person/status/456",
      note: "",
    };
    let listCalls = 0;
    const sendMessage = ((request) => {
      if (request.type === "GET_STATUS") {
        return Promise.resolve({ ok: true as const, data: readyStatus });
      }
      if (request.type === "LIST_BOOKMARKS") {
        listCalls += 1;
        return Promise.resolve({
          ok: true as const,
          data: { items: listCalls === 1 ? [] : [newBookmark], nextCursor: null },
        });
      }
      if (request.type === "GET_BOOKMARK") {
        return Promise.resolve({ ok: true as const, data: { bookmark: newBookmark } });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const app = createPopupApp({ document, locale: "en", sendMessage, translate });
    await app.ready;

    await app.handleLiveBookmarkContext({
      intentId: "intent-live-empty",
      action: "save",
      state: "saved",
      bookmark: newBookmark,
      updatedAt: "2026-08-09T10:00:00.000Z",
    });

    expect(listCalls).toBe(2);
    expect(document.getElementById("bookmark-list")?.textContent).toContain(
      "New live bookmark",
    );
    expect(document.getElementById("selected-bookmark-title")?.textContent).toBe(
      "New live bookmark",
    );
    app.destroy();
  });

  it("refreshes a completed live bookmark once without replacing the active draft", async () => {
    const newBookmark = {
      ...libraryBookmark,
      id: "456",
      text: "New live bookmark",
      url: "https://x.com/person/status/456",
      note: "",
    };
    let listCalls = 0;
    let statusCalls = 0;
    const sendMessage = ((request) => {
      if (request.type === "GET_STATUS") {
        statusCalls += 1;
        return Promise.resolve({ ok: true as const, data: readyStatus });
      }
      if (request.type === "LIST_BOOKMARKS") {
        listCalls += 1;
        return Promise.resolve({
          ok: true as const,
          data: {
            items: listCalls === 1 ? [libraryBookmark] : [newBookmark, libraryBookmark],
            nextCursor: null,
          },
        });
      }
      if (request.type === "GET_BOOKMARK") {
        const selected = request.payload.id === "456" ? newBookmark : libraryBookmark;
        return Promise.resolve({ ok: true as const, data: { bookmark: selected } });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const app = createPopupApp({ document, locale: "en", sendMessage, translate });
    await app.ready;
    const textarea = document.getElementById("note-textarea") as HTMLTextAreaElement;
    textarea.value = "Unsaved active draft";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    const completed = {
      intentId: "intent-live",
      action: "save" as const,
      state: "saved" as const,
      bookmark: newBookmark,
      updatedAt: "2026-08-09T10:00:00.000Z",
    };
    await Promise.all([
      app.handleLiveBookmarkContext(completed),
      app.handleLiveBookmarkContext(completed),
    ]);

    expect(listCalls).toBe(2);
    expect(statusCalls).toBe(2);
    expect(document.getElementById("bookmark-list")?.textContent).toContain(
      "New live bookmark",
    );
    expect(document.getElementById("selected-bookmark-title")?.textContent).toBe(
      libraryBookmark.text,
    );
    expect(textarea.value).toBe("Unsaved active draft");
    app.destroy();
  });

  it("opens the uncategorized view by default and selects its first bookmark", async () => {
    const requests: Array<{ type: string; payload?: unknown }> = [];
    const sendMessage = ((request) => {
      requests.push(request);
      if (request.type === "GET_STATUS") {
        return Promise.resolve({ ok: true as const, data: readyStatus });
      }
      if (request.type === "LIST_BOOKMARKS") {
        return Promise.resolve({
          ok: true as const,
          data: { items: [libraryBookmark], nextCursor: null },
        });
      }
      if (request.type === "GET_BOOKMARK") {
        return Promise.resolve({
          ok: true as const,
          data: { bookmark: libraryBookmark },
        });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const app = createPopupApp({ document, locale: "en", sendMessage, translate });
    await app.ready;

    expect(requests).toContainEqual({
      type: "LIST_BOOKMARKS",
      payload: { view: "inbox" },
    });
    expect(requests.some(({ type }) => type === "GET_BOOKMARK")).toBe(true);
    expect(
      document.getElementById("view-inbox-button")?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(document.getElementById("view-inbox-button")?.getAttribute("tabindex")).toBe(
      "0",
    );
    expect(
      document.getElementById("view-current-button")?.getAttribute("tabindex"),
    ).toBe("-1");
    expect(
      document.getElementById("library-view-panel")?.getAttribute("aria-labelledby"),
    ).toBe("view-inbox-button");
    expect(document.getElementById("bookmark-list")?.textContent).toContain(
      "A useful bookmark",
    );
    expect(
      (document.getElementById("note-textarea") as HTMLTextAreaElement).value,
    ).toBe("Read this again");
    expect(document.getElementById("selected-bookmark-title")?.textContent).toBe(
      "A useful bookmark",
    );
    expect(document.getElementById("selected-category-indicator")?.textContent).toBe(
      "bookmarkNeedsCategory",
    );
    app.destroy();
  });

  it("switches views with roving keyboard focus and localizes each empty state", async () => {
    const listViews: string[] = [];
    const sendMessage = ((request) => {
      if (request.type === "GET_STATUS") {
        return Promise.resolve({ ok: true as const, data: readyStatus });
      }
      if (request.type === "LIST_BOOKMARKS") {
        listViews.push(request.payload?.view ?? "current");
        return Promise.resolve({
          ok: true as const,
          data: { items: [], nextCursor: null },
        });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const app = createPopupApp({ document, locale: "en", sendMessage, translate });
    await app.ready;

    const inbox = document.getElementById("view-inbox-button") as HTMLButtonElement;
    const current = document.getElementById("view-current-button") as HTMLButtonElement;
    const archived = document.getElementById(
      "view-archived-button",
    ) as HTMLButtonElement;
    expect(document.getElementById("library-empty")?.textContent).toBe(
      "libraryEmptyInbox",
    );

    inbox.focus();
    inbox.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    await vi.waitFor(() => expect(listViews).toEqual(["inbox", "current"]));
    expect(document.activeElement).toBe(current);
    expect(current.getAttribute("aria-selected")).toBe("true");
    expect(current.tabIndex).toBe(0);
    expect(inbox.tabIndex).toBe(-1);
    expect(document.getElementById("library-empty")?.textContent).toBe(
      "libraryEmptyCurrent",
    );

    current.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    await vi.waitFor(() => expect(listViews).toEqual(["inbox", "current", "archived"]));
    expect(document.activeElement).toBe(archived);
    expect(
      document.getElementById("library-view-panel")?.getAttribute("aria-labelledby"),
    ).toBe("view-archived-button");
    expect(document.getElementById("library-empty")?.textContent).toBe(
      "libraryEmptyArchived",
    );
    app.destroy();
  });

  it("invalidates a stale list response when the selected view changes", async () => {
    const staleInbox = deferred<{
      ok: true;
      data: { items: NotedBookmark[]; nextCursor: null };
    }>();
    const listViews: string[] = [];
    const sendMessage = ((request) => {
      if (request.type === "GET_STATUS") {
        return Promise.resolve({ ok: true as const, data: readyStatus });
      }
      if (request.type === "LIST_BOOKMARKS") {
        const view = request.payload?.view ?? "current";
        listViews.push(view);
        if (view === "inbox") return staleInbox.promise;
        return Promise.resolve({
          ok: true as const,
          data: { items: [], nextCursor: null },
        });
      }
      if (request.type === "GET_BOOKMARK") {
        return Promise.resolve({
          ok: true as const,
          data: { bookmark: libraryBookmark },
        });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const app = createPopupApp({ document, locale: "en", sendMessage, translate });
    await vi.waitFor(() => expect(listViews).toEqual(["inbox"]));

    document.getElementById("view-current-button")?.click();
    await vi.waitFor(() => expect(listViews).toEqual(["inbox", "current"]));
    staleInbox.resolve({
      ok: true,
      data: { items: [libraryBookmark], nextCursor: null },
    });
    await app.ready;

    expect(document.getElementById("bookmark-list")?.children).toHaveLength(0);
    expect(document.getElementById("note-editor")?.hidden).toBe(true);
    expect(
      document.getElementById("view-current-button")?.getAttribute("aria-selected"),
    ).toBe("true");
    app.destroy();
  });

  it("flushes a pending note and disconnects its editor before switching views", async () => {
    const savedNotes: Array<{ id: string; note: string }> = [];
    const sendMessage = ((request) => {
      if (request.type === "GET_STATUS") {
        return Promise.resolve({ ok: true as const, data: readyStatus });
      }
      if (request.type === "LIST_BOOKMARKS") {
        return Promise.resolve({
          ok: true as const,
          data: {
            items: request.payload?.view === "inbox" ? [libraryBookmark] : [],
            nextCursor: null,
          },
        });
      }
      if (request.type === "GET_BOOKMARK") {
        return Promise.resolve({
          ok: true as const,
          data: { bookmark: libraryBookmark },
        });
      }
      if (request.type === "SAVE_BOOKMARK_NOTE") {
        savedNotes.push(request.payload);
        return Promise.resolve({
          ok: true as const,
          data: {
            bookmark: { ...libraryBookmark, note: request.payload.note },
          },
        });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const app = createPopupApp({ document, locale: "en", sendMessage, translate });
    await app.ready;

    const textarea = document.getElementById("note-textarea") as HTMLTextAreaElement;
    textarea.value = "Keep this draft";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("view-archived-button")?.click();

    await vi.waitFor(() =>
      expect(savedNotes).toEqual([{ id: libraryBookmark.id, note: "Keep this draft" }]),
    );
    expect(document.getElementById("note-editor")?.hidden).toBe(true);
    expect(textarea.disabled).toBe(true);
    expect(textarea.value).toBe("");
    app.destroy();
  });

  it("keeps pagination scoped to the selected view", async () => {
    const listPayloads: Array<{ view?: string; cursor?: string }> = [];
    const sendMessage = ((request) => {
      if (request.type === "GET_STATUS") {
        return Promise.resolve({ ok: true as const, data: readyStatus });
      }
      if (request.type === "LIST_BOOKMARKS") {
        listPayloads.push(request.payload ?? {});
        return Promise.resolve({
          ok: true as const,
          data: {
            items: request.payload?.cursor ? [] : [libraryBookmark],
            nextCursor: request.payload?.cursor ? null : "archived:next",
          },
        });
      }
      if (request.type === "GET_BOOKMARK") {
        return Promise.resolve({
          ok: true as const,
          data: { bookmark: libraryBookmark },
        });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const app = createPopupApp({ document, locale: "en", sendMessage, translate });
    await app.ready;

    document.getElementById("view-archived-button")?.click();
    await vi.waitFor(() => expect(listPayloads).toHaveLength(2));
    document.getElementById("load-more-bookmarks")?.click();
    await vi.waitFor(() => expect(listPayloads).toHaveLength(3));

    expect(listPayloads).toEqual([
      { view: "inbox" },
      { view: "archived" },
      { view: "archived", cursor: "archived:next" },
    ]);
    app.destroy();
  });

  it("adds a plain-text tag on Enter and removes it from an accessible badge", async () => {
    const unsafeName = '<img src=x onerror="alert(1)">';
    const tag = {
      id: "tag-security",
      name: unsafeName,
      normalizedName: unsafeName,
    };
    const taggedBookmark = { ...libraryBookmark, tagIds: [tag.id] };
    const requests: string[] = [];
    const sendMessage = ((request) => {
      requests.push(request.type);
      if (request.type === "GET_STATUS") {
        return Promise.resolve({ ok: true as const, data: readyStatus });
      }
      if (request.type === "LIST_BOOKMARKS") {
        return Promise.resolve({
          ok: true as const,
          data: { items: [libraryBookmark], nextCursor: null },
        });
      }
      if (request.type === "GET_BOOKMARK") {
        return Promise.resolve({
          ok: true as const,
          data: { bookmark: libraryBookmark },
        });
      }
      if (request.type === "LIST_TAGS") {
        return Promise.resolve({ ok: true as const, data: { tags: [] } });
      }
      if (request.type === "ADD_BOOKMARK_TAG") {
        return Promise.resolve({
          ok: true as const,
          data: { bookmark: taggedBookmark, tag },
        });
      }
      if (request.type === "REMOVE_BOOKMARK_TAG") {
        return Promise.resolve({
          ok: true as const,
          data: { bookmark: libraryBookmark },
        });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const app = createPopupApp({ document, locale: "en", sendMessage, translate });
    await app.ready;

    const input = document.getElementById("tag-input") as HTMLInputElement;
    input.value = `  ${unsafeName}  `;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    await vi.waitFor(() => expect(requests).toContain("ADD_BOOKMARK_TAG"));
    await vi.waitFor(() =>
      expect(document.getElementById("selected-tags")?.textContent).toContain(
        unsafeName,
      ),
    );
    expect(document.querySelector("#selected-tags img")).toBeNull();
    const remove = document.querySelector<HTMLButtonElement>(
      '#selected-tags [data-tag-id="tag-security"]',
    );
    expect(remove?.getAttribute("aria-label")).toBe(`removeTagLabel:${unsafeName}`);
    remove?.click();
    await vi.waitFor(() => expect(requests).toContain("REMOVE_BOOKMARK_TAG"));
    await vi.waitFor(() =>
      expect(document.getElementById("selected-tags")?.textContent).not.toContain(
        unsafeName,
      ),
    );
    app.destroy();
  });

  it("keeps a tag added while the startup tag list is still loading", async () => {
    const startupTags = deferred<{
      ok: true;
      data: { tags: [] };
    }>();
    const tag = {
      id: "tag-research",
      name: "Research",
      normalizedName: "research",
    };
    const taggedBookmark = { ...libraryBookmark, tagIds: [tag.id] };
    const sendMessage = ((request) => {
      if (request.type === "GET_STATUS") {
        return Promise.resolve({ ok: true as const, data: readyStatus });
      }
      if (request.type === "LIST_BOOKMARKS") {
        return Promise.resolve({
          ok: true as const,
          data: { items: [libraryBookmark], nextCursor: null },
        });
      }
      if (request.type === "GET_BOOKMARK") {
        return Promise.resolve({
          ok: true as const,
          data: { bookmark: libraryBookmark },
        });
      }
      if (request.type === "LIST_TAGS") return startupTags.promise;
      if (request.type === "ADD_BOOKMARK_TAG") {
        return Promise.resolve({
          ok: true as const,
          data: { bookmark: taggedBookmark, tag },
        });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const app = createPopupApp({ document, locale: "en", sendMessage, translate });
    const input = document.getElementById("tag-input") as HTMLInputElement;
    await vi.waitFor(() => expect(input.disabled).toBe(false));

    input.value = "Research";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() =>
      expect(document.getElementById("selected-tags")?.textContent).toContain(
        "Research",
      ),
    );

    startupTags.resolve({ ok: true, data: { tags: [] } });
    await app.ready;
    expect(document.getElementById("selected-tags")?.textContent).toContain("Research");
    app.destroy();
  });

  it("disconnects folder controls while a newly selected bookmark is loading", async () => {
    const secondBookmark: NotedBookmark = {
      ...libraryBookmark,
      id: "456",
      text: "A second bookmark",
      url: "https://x.com/person/status/456",
      folderId: "folder-b",
    };
    const firstBookmark = { ...libraryBookmark, folderId: "folder-a" };
    const secondDetail = deferred<{
      ok: true;
      data: { bookmark: NotedBookmark };
    }>();
    const assignments: Array<{ bookmarkId: string; folderId: string | null }> = [];
    let secondDetailRequested = false;
    const sendMessage = ((request) => {
      if (request.type === "GET_STATUS") {
        return Promise.resolve({ ok: true as const, data: readyStatus });
      }
      if (request.type === "LIST_BOOKMARKS") {
        return Promise.resolve({
          ok: true as const,
          data: { items: [firstBookmark, secondBookmark], nextCursor: null },
        });
      }
      if (request.type === "LIST_FOLDERS") {
        return Promise.resolve({
          ok: true as const,
          data: {
            folders: [
              { id: "folder-a", name: "A", parentId: null },
              { id: "folder-b", name: "B", parentId: null },
            ],
          },
        });
      }
      if (request.type === "GET_BOOKMARK") {
        if (request.payload.id === secondBookmark.id) {
          secondDetailRequested = true;
          return secondDetail.promise;
        }
        return Promise.resolve({
          ok: true as const,
          data: { bookmark: firstBookmark },
        });
      }
      if (request.type === "ASSIGN_BOOKMARK_FOLDER") {
        assignments.push(request.payload);
        return Promise.resolve({
          ok: true as const,
          data: { bookmark: firstBookmark },
        });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const app = createPopupApp({ document, locale: "en", sendMessage, translate });
    await app.ready;

    document.querySelector<HTMLButtonElement>('[data-bookmark-id="456"]')?.click();
    await vi.waitFor(() => expect(secondDetailRequested).toBe(true));
    const folderSelect = document.getElementById(
      "folder-assignment",
    ) as HTMLSelectElement;
    expect(folderSelect.disabled).toBe(true);
    expect(folderSelect.value).toBe("");
    folderSelect.value = "folder-b";
    folderSelect.dispatchEvent(new Event("change", { bubbles: true }));
    expect(assignments).toEqual([]);

    secondDetail.resolve({
      ok: true,
      data: { bookmark: secondBookmark },
    });
    await vi.waitFor(() => expect(folderSelect.value).toBe("folder-b"));
    expect(folderSelect.disabled).toBe(false);
    app.destroy();
  });

  it("dispatches the latest debounced note before popup teardown", async () => {
    const firstSave = deferred<{
      ok: true;
      data: { bookmark: NotedBookmark };
    }>();
    const scheduled: Array<{ callback: () => void; delay: number }> = [];
    const cancelled: number[] = [];
    const savedNotes: Array<{ id: string; note: string }> = [];
    const schedule = ((callback: () => void, delay = 0) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    }) as typeof window.setTimeout;
    const sendMessage = ((request) => {
      if (request.type === "GET_STATUS") {
        return Promise.resolve({ ok: true as const, data: readyStatus });
      }
      if (request.type === "LIST_BOOKMARKS") {
        return Promise.resolve({
          ok: true as const,
          data: { items: [libraryBookmark], nextCursor: null },
        });
      }
      if (request.type === "LIST_FOLDERS") {
        return Promise.resolve({ ok: true as const, data: { folders: [] } });
      }
      if (request.type === "GET_BOOKMARK") {
        return Promise.resolve({
          ok: true as const,
          data: { bookmark: libraryBookmark },
        });
      }
      if (request.type === "SAVE_BOOKMARK_NOTE") {
        savedNotes.push(request.payload);
        if (savedNotes.length === 1) return firstSave.promise;
        return Promise.resolve({
          ok: true as const,
          data: {
            bookmark: { ...libraryBookmark, note: request.payload.note },
          },
        });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const app = createPopupApp({
      document,
      locale: "en",
      sendMessage,
      translate,
      schedule,
      cancelSchedule: ((handle: number) =>
        cancelled.push(handle)) as typeof window.clearTimeout,
    });
    await app.ready;

    const textarea = document.getElementById("note-textarea") as HTMLTextAreaElement;
    textarea.value = "Already dispatched";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    expect(savedNotes).toEqual([]);
    scheduled.find(({ delay }) => delay === 400)?.callback();
    await vi.waitFor(() =>
      expect(savedNotes).toEqual([{ id: "123", note: "Already dispatched" }]),
    );

    textarea.value = "Save before close";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    app.destroy();

    expect(savedNotes).toEqual([
      { id: "123", note: "Already dispatched" },
      { id: "123", note: "Save before close" },
    ]);
    expect(cancelled).toContain(2);
    firstSave.resolve({
      ok: true,
      data: { bookmark: { ...libraryBookmark, note: "Already dispatched" } },
    });
  });

  it("serializes and coalesces autosaves without applying stale responses", async () => {
    const firstSave = deferred<{
      ok: true;
      data: { bookmark: NotedBookmark };
    }>();
    const secondSave = deferred<{
      ok: true;
      data: { bookmark: NotedBookmark };
    }>();
    const saveRequests: Array<{ id: string; note: string }> = [];
    const scheduled: Array<{ callback: () => void; delay: number }> = [];
    const schedule = ((callback: () => void, delay = 0) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    }) as typeof window.setTimeout;
    const flushNoteDebounce = (): void => {
      scheduled
        .slice()
        .reverse()
        .find((entry) => entry.delay === 400)
        ?.callback();
    };
    const sendMessage = ((request) => {
      if (request.type === "GET_STATUS") {
        return Promise.resolve({ ok: true as const, data: readyStatus });
      }
      if (request.type === "LIST_BOOKMARKS") {
        return Promise.resolve({
          ok: true as const,
          data: { items: [libraryBookmark], nextCursor: null },
        });
      }
      if (request.type === "GET_BOOKMARK") {
        return Promise.resolve({
          ok: true as const,
          data: { bookmark: libraryBookmark },
        });
      }
      if (request.type === "SAVE_BOOKMARK_NOTE") {
        saveRequests.push(request.payload);
        return saveRequests.length === 1 ? firstSave.promise : secondSave.promise;
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const app = createPopupApp({
      document,
      locale: "en",
      sendMessage,
      translate,
      schedule,
      cancelSchedule: vi.fn(),
    });
    await app.ready;

    const textarea = document.getElementById("note-textarea") as HTMLTextAreaElement;
    textarea.value = "first draft";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.getElementById("note-save-status")?.textContent).toBe("noteSaving");
    flushNoteDebounce();
    await Promise.resolve();
    expect(saveRequests).toEqual([{ id: "123", note: "first draft" }]);

    textarea.value = "newest draft";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    flushNoteDebounce();
    expect(saveRequests).toHaveLength(1);

    firstSave.resolve({
      ok: true,
      data: { bookmark: { ...libraryBookmark, note: "first draft" } },
    });
    await vi.waitFor(() => expect(saveRequests).toHaveLength(2));
    expect(textarea.value).toBe("newest draft");
    expect(document.getElementById("note-save-status")?.textContent).toBe("noteSaving");

    secondSave.resolve({
      ok: true,
      data: { bookmark: { ...libraryBookmark, note: "newest draft" } },
    });
    await vi.waitFor(() =>
      expect(document.getElementById("note-save-status")?.textContent).toBe(
        "noteSaved",
      ),
    );
    expect(textarea.value).toBe("newest draft");
    app.destroy();
  });

  it("guides the user to open the bookmarks page before capture", async () => {
    const requests: string[] = [];
    const sendMessage = ((request) => {
      requests.push(request.type);
      return Promise.resolve(
        request.type === "GET_STATUS"
          ? { ok: true as const, data: emptyStatus }
          : { ok: true as const, data: undefined },
      );
    }) as SendMessage;
    const app = createPopupApp({ document, locale: "en", sendMessage, translate });
    await app.ready;

    expect(document.getElementById("page-guidance")?.textContent).toBe(
      "pageMissingGuidance",
    );
    const captureButton = document.getElementById(
      "capture-button",
    ) as HTMLButtonElement;
    expect(captureButton.disabled).toBe(true);
    expect(captureButton.hidden).toBe(true);

    document.getElementById("open-bookmarks-button")?.click();
    await vi.waitFor(() => expect(requests).toContain("OPEN_BOOKMARKS"));
    app.destroy();
  });

  it("captures from a ready page and renders archive totals", async () => {
    const requests: string[] = [];
    const sendMessage = ((request) => {
      requests.push(request.type);
      return Promise.resolve(
        request.type === "GET_STATUS"
          ? { ok: true as const, data: readyStatus }
          : { ok: true as const, data: undefined },
      );
    }) as SendMessage;
    const app = createPopupApp({ document, locale: "en", sendMessage, translate });
    await app.ready;

    expect(document.getElementById("total-count")?.textContent).toBe("42");
    expect(document.getElementById("capture-state")?.textContent).toBe(
      "captureCompleteFull",
    );
    document.getElementById("capture-button")?.click();
    await vi.waitFor(() => expect(requests).toContain("START_SCRAPE"));
    app.destroy();
  });

  it("offers a simple quick or full selector and sends the selected mode", async () => {
    const requests: unknown[] = [];
    const sendMessage = ((request) => {
      requests.push(request);
      if (request.type === "GET_STATUS") {
        return Promise.resolve({ ok: true as const, data: readyStatus });
      }
      if (request.type === "LIST_BOOKMARKS") {
        return Promise.resolve({
          ok: true as const,
          data: { items: [libraryBookmark], nextCursor: null },
        });
      }
      if (request.type === "LIST_TAGS") {
        return Promise.resolve({ ok: true as const, data: { tags: [] } });
      }
      if (request.type === "LIST_FOLDERS") {
        return Promise.resolve({ ok: true as const, data: { folders: [] } });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const app = createPopupApp({ document, locale: "en", sendMessage, translate });
    await app.ready;

    const mode = document.getElementById("capture-mode") as HTMLSelectElement;
    expect(mode.value).toBe("quick");
    expect(mode.getAttribute("aria-describedby")).toBe("capture-mode-help");
    mode.value = "full";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
    document.getElementById("capture-button")?.click();

    await vi.waitFor(() =>
      expect(requests).toContainEqual({
        type: "START_SCRAPE",
        payload: { mode: "full" },
      }),
    );
    app.destroy();
  });

  it("forces the first capture to full and shows the thirty-day reminder discreetly", async () => {
    const firstCaptureStatus: PopupStatus = {
      ...readyStatus,
      scrape: null,
      quickUpdateAvailable: false,
      fullReviewDue: true,
    };
    const sendMessage = ((request) => {
      if (request.type === "GET_STATUS") {
        return Promise.resolve({ ok: true as const, data: firstCaptureStatus });
      }
      if (request.type === "LIST_BOOKMARKS") {
        return Promise.resolve({
          ok: true as const,
          data: { items: [], nextCursor: null },
        });
      }
      return Promise.resolve({ ok: true as const, data: { tags: [], folders: [] } });
    }) as SendMessage;
    const app = createPopupApp({ document, locale: "en", sendMessage, translate });
    await app.ready;

    const mode = document.getElementById("capture-mode") as HTMLSelectElement;
    expect(mode.value).toBe("full");
    expect(
      mode.querySelector<HTMLOptionElement>('option[value="quick"]')?.disabled,
    ).toBe(true);
    expect(document.getElementById("capture-mode-help")?.textContent).toBe(
      "captureModeFirstFullHelp",
    );
    expect(document.getElementById("full-review-reminder")?.hidden).toBe(false);
    expect(document.getElementById("full-review-reminder")?.textContent).toBe(
      "fullReviewReminder",
    );
    app.destroy();
  });

  it("reloads the library once when a newly started capture completes", async () => {
    const newBookmark: NotedBookmark = {
      ...libraryBookmark,
      id: "456",
      text: "Captured in the new run",
      url: "https://x.com/person/status/456",
      note: "",
    };
    const runningScrape = {
      ...readyStatus.scrape!,
      id: "run-2",
      status: "running" as const,
    };
    const completedScrape = { ...runningScrape, status: "completed" as const };
    const scheduled: Array<{ callback: () => void; delay: number }> = [];
    const schedule = ((callback: () => void, delay = 0) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    }) as typeof window.setTimeout;
    let statusCalls = 0;
    let listCalls = 0;
    const listedViews: string[] = [];
    const sendMessage = ((request) => {
      if (request.type === "GET_STATUS") {
        statusCalls += 1;
        const scrape =
          statusCalls === 1
            ? readyStatus.scrape
            : statusCalls === 2
              ? runningScrape
              : completedScrape;
        return Promise.resolve({
          ok: true as const,
          data: { ...readyStatus, scrape },
        });
      }
      if (request.type === "LIST_BOOKMARKS") {
        listCalls += 1;
        listedViews.push(request.payload?.view ?? "current");
        return Promise.resolve({
          ok: true as const,
          data: {
            items: listCalls === 1 ? [libraryBookmark] : [libraryBookmark, newBookmark],
            nextCursor: null,
          },
        });
      }
      if (request.type === "GET_BOOKMARK") {
        const bookmark =
          request.payload.id === newBookmark.id ? newBookmark : libraryBookmark;
        return Promise.resolve({ ok: true as const, data: { bookmark } });
      }
      if (request.type === "START_SCRAPE") {
        return Promise.resolve({ ok: true as const, data: runningScrape });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const app = createPopupApp({
      document,
      locale: "en",
      sendMessage,
      translate,
      schedule,
      cancelSchedule: vi.fn(),
    });
    await app.ready;

    document.getElementById("capture-button")?.click();
    await vi.waitFor(() => expect(statusCalls).toBe(2));
    const textarea = document.getElementById("note-textarea") as HTMLTextAreaElement;
    textarea.value = "Draft written during capture";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    const poll = scheduled.find((item) => item.delay === 1_000);
    expect(poll).toBeDefined();
    poll?.callback();

    await vi.waitFor(() => expect(listCalls).toBe(2));
    expect(document.getElementById("bookmark-list")?.textContent).toContain(
      "Captured in the new run",
    );
    expect(textarea.value).toBe("Draft written during capture");
    expect(document.getElementById("note-save-status")?.textContent).toBe("noteSaving");
    expect(listedViews).toEqual(["inbox", "inbox"]);
    expect(scheduled.filter((item) => item.delay === 1_000)).toHaveLength(1);
    app.destroy();
  });

  it("refreshes new uncategorized captures without opening their editor", async () => {
    const newBookmark: NotedBookmark = {
      ...libraryBookmark,
      id: "new-from-capture",
      text: "Needs categorization",
      url: "https://x.com/person/status/new-from-capture",
      note: "",
    };
    const runningScrape = {
      ...readyStatus.scrape!,
      id: "run-with-empty-inbox",
      status: "running" as const,
    };
    const completedScrape = { ...runningScrape, status: "completed" as const };
    const scheduled: Array<{ callback: () => void; delay: number }> = [];
    const schedule = ((callback: () => void, delay = 0) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    }) as typeof window.setTimeout;
    let statusCalls = 0;
    let listCalls = 0;
    let detailCalls = 0;
    const sendMessage = ((request) => {
      if (request.type === "GET_STATUS") {
        statusCalls += 1;
        const scrape =
          statusCalls === 1
            ? readyStatus.scrape
            : statusCalls === 2
              ? runningScrape
              : completedScrape;
        return Promise.resolve({
          ok: true as const,
          data: { ...readyStatus, scrape },
        });
      }
      if (request.type === "LIST_BOOKMARKS") {
        listCalls += 1;
        return Promise.resolve({
          ok: true as const,
          data: {
            items: listCalls === 1 ? [] : [newBookmark],
            nextCursor: null,
          },
        });
      }
      if (request.type === "GET_BOOKMARK") {
        detailCalls += 1;
        return Promise.resolve({
          ok: true as const,
          data: { bookmark: newBookmark },
        });
      }
      if (request.type === "START_SCRAPE") {
        return Promise.resolve({ ok: true as const, data: runningScrape });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const app = createPopupApp({
      document,
      locale: "en",
      sendMessage,
      translate,
      schedule,
      cancelSchedule: vi.fn(),
    });
    await app.ready;

    expect(detailCalls).toBe(0);
    document.getElementById("capture-button")?.click();
    await vi.waitFor(() => expect(statusCalls).toBe(2));
    scheduled.find((item) => item.delay === 1_000)?.callback();
    await vi.waitFor(() => expect(listCalls).toBe(2));

    expect(document.getElementById("bookmark-list")?.textContent).toContain(
      "Needs categorization",
    );
    expect(detailCalls).toBe(0);
    expect(document.getElementById("note-editor")?.hidden).toBe(true);
    app.destroy();
  });

  it("coalesces a completed-capture refresh behind an in-flight bookmark page", async () => {
    const pagedBookmark: NotedBookmark = {
      ...libraryBookmark,
      id: "456",
      text: "Older second page",
      url: "https://x.com/person/status/456",
    };
    const capturedBookmark: NotedBookmark = {
      ...libraryBookmark,
      id: "789",
      text: "Captured while the page was loading",
      url: "https://x.com/person/status/789",
    };
    const runningScrape = {
      ...readyStatus.scrape!,
      id: "run-busy",
      status: "running" as const,
    };
    const completedScrape = { ...runningScrape, status: "completed" as const };
    const pageInFlight = deferred<{
      ok: true;
      data: { items: NotedBookmark[]; nextCursor: null };
    }>();
    const scheduled: Array<{ callback: () => void; delay: number }> = [];
    const schedule = ((callback: () => void, delay = 0) => {
      scheduled.push({ callback, delay });
      return scheduled.length;
    }) as typeof window.setTimeout;
    let statusCalls = 0;
    let listCalls = 0;
    const sendMessage = ((request) => {
      if (request.type === "GET_STATUS") {
        statusCalls += 1;
        const scrape =
          statusCalls === 1
            ? readyStatus.scrape
            : statusCalls === 2
              ? runningScrape
              : completedScrape;
        return Promise.resolve({
          ok: true as const,
          data: { ...readyStatus, scrape },
        });
      }
      if (request.type === "LIST_BOOKMARKS") {
        listCalls += 1;
        if (listCalls === 1) {
          return Promise.resolve({
            ok: true as const,
            data: { items: [libraryBookmark], nextCursor: "next" },
          });
        }
        if (listCalls === 2) return pageInFlight.promise;
        return Promise.resolve({
          ok: true as const,
          data: {
            items: [libraryBookmark, pagedBookmark, capturedBookmark],
            nextCursor: null,
          },
        });
      }
      if (request.type === "GET_BOOKMARK") {
        return Promise.resolve({
          ok: true as const,
          data: { bookmark: libraryBookmark },
        });
      }
      if (request.type === "START_SCRAPE") {
        return Promise.resolve({ ok: true as const, data: runningScrape });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const app = createPopupApp({
      document,
      locale: "en",
      sendMessage,
      translate,
      schedule,
      cancelSchedule: vi.fn(),
    });
    await app.ready;

    document.getElementById("capture-button")?.click();
    await vi.waitFor(() => expect(statusCalls).toBe(2));
    document.getElementById("load-more-bookmarks")?.click();
    await vi.waitFor(() => expect(listCalls).toBe(2));
    scheduled.find((item) => item.delay === 1_000)?.callback();
    await vi.waitFor(() => expect(statusCalls).toBe(3));

    pageInFlight.resolve({
      ok: true,
      data: { items: [pagedBookmark], nextCursor: null },
    });
    await vi.waitFor(() => expect(listCalls).toBe(3));
    expect(document.getElementById("bookmark-list")?.textContent).toContain(
      "Captured while the page was loading",
    );
    expect(scheduled.filter((item) => item.delay === 1_000)).toHaveLength(1);
    app.destroy();
  });

  it("shows how many existing bookmarks were skipped as duplicates", async () => {
    const sendMessage = (() =>
      Promise.resolve({ ok: true as const, data: readyStatus })) as SendMessage;
    const app = createPopupApp({ document, locale: "en", sendMessage, translate });
    await app.ready;

    const duplicateSummary = document.getElementById("duplicate-summary");
    expect(duplicateSummary?.hidden).toBe(false);
    expect(duplicateSummary?.textContent).toBe("duplicatesSkipped:2");
    app.destroy();
  });

  it("shows live progress and allows a running capture to be cancelled", async () => {
    const runningStatus: PopupStatus = {
      ...readyStatus,
      pageReady: false,
      scrape: { ...readyStatus.scrape!, status: "running", fetched: 18 },
    };
    const requests: string[] = [];
    const sendMessage = ((request) => {
      requests.push(request.type);
      return Promise.resolve(
        request.type === "GET_STATUS"
          ? { ok: true as const, data: runningStatus }
          : { ok: true as const, data: undefined },
      );
    }) as SendMessage;
    const app = createPopupApp({ document, locale: "en", sendMessage, translate });
    await app.ready;

    expect(document.getElementById("capture-progress")?.hidden).toBe(false);
    expect(document.getElementById("capture-progress-copy")?.textContent).toBe(
      "captureProgress:18",
    );
    expect(document.getElementById("capture-feedback")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    const button = document.getElementById("capture-button") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    button.click();
    await vi.waitFor(() => expect(requests).toContain("CANCEL_SCRAPE"));
    app.destroy();
  });

  it("exports TXT and announces localized safe errors", async () => {
    const createDownload = vi.fn();
    let shouldFail = false;
    const sendMessage = ((request) => {
      if (request.type === "GET_STATUS") {
        return Promise.resolve({ ok: true as const, data: readyStatus });
      }
      if (shouldFail) {
        return Promise.resolve({
          ok: false as const,
          error: { code: "content_script_unavailable", message: "raw detail" },
        });
      }
      return Promise.resolve({
        ok: true as const,
        data: { content: "\uFEFFarchive", filename: "bookmark-x.txt" },
      });
    }) as SendMessage;
    const app = createPopupApp({
      document,
      locale: "pt_BR",
      sendMessage,
      translate,
      createDownload,
    });
    await app.ready;

    document.getElementById("export-primary-button")?.click();
    await vi.waitFor(() =>
      expect(createDownload).toHaveBeenCalledWith({
        content: "\uFEFFarchive",
        filename: "bookmark-x.txt",
      }),
    );

    shouldFail = true;
    document.getElementById("capture-button")?.click();
    await vi.waitFor(() => {
      expect(document.getElementById("alert")?.textContent).toBe("errorReloadPage");
      expect(document.getElementById("alert")?.textContent).not.toContain("raw detail");
    });
    app.destroy();
  });

  it("reloads an empty library and resets the editor after clearing the archive", async () => {
    let cleared = false;
    let listCalls = 0;
    const sendMessage = ((request) => {
      if (request.type === "GET_STATUS") {
        return Promise.resolve({
          ok: true as const,
          data: cleared ? emptyStatus : readyStatus,
        });
      }
      if (request.type === "LIST_BOOKMARKS") {
        listCalls += 1;
        return Promise.resolve({
          ok: true as const,
          data: {
            items: cleared ? [] : [libraryBookmark],
            nextCursor: null,
          },
        });
      }
      if (request.type === "GET_BOOKMARK") {
        return Promise.resolve({
          ok: true as const,
          data: { bookmark: libraryBookmark },
        });
      }
      if (request.type === "CLEAR_ARCHIVE") {
        cleared = true;
        return Promise.resolve({ ok: true as const, data: null });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const app = createPopupApp({ document, locale: "en", sendMessage, translate });
    await app.ready;

    expect(
      (document.getElementById("note-textarea") as HTMLTextAreaElement).value,
    ).toBe("Read this again");
    document.getElementById("confirm-clear-button")?.click();

    await vi.waitFor(() => expect(listCalls).toBe(2));
    expect(document.getElementById("bookmark-list")?.children).toHaveLength(0);
    expect(document.getElementById("note-editor")?.hidden).toBe(true);
    const textarea = document.getElementById("note-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
    expect(textarea.disabled).toBe(true);
    app.destroy();
  });

  it("downloads a complete JSON backup through the local download path", async () => {
    const createDownload = vi.fn();
    const sendMessage = ((request) => {
      if (request.type === "GET_STATUS") {
        return Promise.resolve({ ok: true as const, data: emptyStatus });
      }
      if (request.type === "LIST_BOOKMARKS") {
        return Promise.resolve({
          ok: true as const,
          data: { items: [], nextCursor: null },
        });
      }
      if (request.type === "LIST_TAGS") {
        return Promise.resolve({ ok: true as const, data: { tags: [] } });
      }
      if (request.type === "LIST_FOLDERS") {
        return Promise.resolve({ ok: true as const, data: { folders: [] } });
      }
      if (request.type === "EXPORT_BACKUP") {
        return Promise.resolve({
          ok: true as const,
          data: {
            content: '{"schemaVersion":1}',
            filename: "bookmark-x-backup.json",
          },
        });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const app = createPopupApp({
      document,
      locale: "en",
      sendMessage,
      translate,
      createDownload,
    });
    await app.ready;

    document.getElementById("export-backup-button")?.click();

    await vi.waitFor(() =>
      expect(createDownload).toHaveBeenCalledWith({
        content: '{"schemaVersion":1}',
        filename: "bookmark-x-backup.json",
      }),
    );
    app.destroy();
  });

  it("requires explicit replace confirmation before reading or restoring a file", async () => {
    const requests: string[] = [];
    let listCalls = 0;
    const readBackupFile = vi.fn(async () => '{"schemaVersion":1}');
    const confirmRestore = vi
      .fn<(message: string) => boolean>()
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    const reload = vi.fn();
    const sendMessage = ((request) => {
      requests.push(request.type);
      if (request.type === "GET_STATUS") {
        return Promise.resolve({ ok: true as const, data: emptyStatus });
      }
      if (request.type === "LIST_BOOKMARKS") {
        listCalls += 1;
        return Promise.resolve({
          ok: true as const,
          data: { items: [], nextCursor: null },
        });
      }
      if (request.type === "LIST_TAGS") {
        return Promise.resolve({ ok: true as const, data: { tags: [] } });
      }
      if (request.type === "LIST_FOLDERS") {
        return Promise.resolve({ ok: true as const, data: { folders: [] } });
      }
      if (request.type === "RESTORE_BACKUP") {
        return Promise.resolve({
          ok: true as const,
          data: {
            bookmarks: 2,
            folders: 1,
            tags: 1,
            mode: "replace" as const,
            reloadRequired: true as const,
          },
        });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const app = createPopupApp({
      document,
      locale: "en",
      sendMessage,
      translate,
      readBackupFile,
      confirmRestore,
      reload,
    });
    await app.ready;
    const file = new File(["{}"], '<img src=x onerror="alert(1)">.json', {
      type: "application/json",
    });
    const input = document.getElementById("backup-file-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const mode = document.getElementById("backup-restore-mode") as HTMLSelectElement;
    mode.value = "replace";
    const restore = document.getElementById(
      "restore-backup-button",
    ) as HTMLButtonElement;

    restore.click();
    expect(confirmRestore).toHaveBeenCalledWith("confirmReplaceBackup");
    expect(readBackupFile).not.toHaveBeenCalled();
    expect(requests).not.toContain("RESTORE_BACKUP");

    restore.click();
    await vi.waitFor(() => expect(requests).toContain("RESTORE_BACKUP"));
    expect(readBackupFile).toHaveBeenCalledWith(file);
    await vi.waitFor(() => expect(listCalls).toBe(2));
    expect(reload).toHaveBeenCalledOnce();
    expect(document.querySelector("#backup-status img")).toBeNull();
    app.destroy();
  });

  it("reloads after a settings-only restore failure because library data committed", async () => {
    const reload = vi.fn();
    const sendMessage = ((request) => {
      if (request.type === "GET_STATUS") {
        return Promise.resolve({ ok: true as const, data: emptyStatus });
      }
      if (request.type === "LIST_BOOKMARKS") {
        return Promise.resolve({
          ok: true as const,
          data: { items: [], nextCursor: null },
        });
      }
      if (request.type === "LIST_TAGS") {
        return Promise.resolve({ ok: true as const, data: { tags: [] } });
      }
      if (request.type === "LIST_FOLDERS") {
        return Promise.resolve({ ok: true as const, data: { folders: [] } });
      }
      if (request.type === "RESTORE_BACKUP") {
        return Promise.resolve({
          ok: false as const,
          error: {
            code: "restore_settings_failed",
            message: "safe background detail",
            recovery: { dataRestored: true as const, reloadRequired: true as const },
          },
        });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const app = createPopupApp({
      document,
      locale: "en",
      sendMessage,
      translate,
      readBackupFile: async () => '{"schemaVersion":1}',
      reload,
    });
    await app.ready;
    const file = new File(["{}"], "backup.json", { type: "application/json" });
    const input = document.getElementById("backup-file-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));

    document.getElementById("restore-backup-button")?.click();

    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(document.getElementById("backup-status")?.textContent).toBe(
      "backupRestorePartial",
    );
    expect(document.getElementById("alert")?.textContent).toBe(
      "errorRestoreSettingsFailed",
    );
    expect(document.getElementById("alert")?.textContent).not.toContain(
      "safe background detail",
    );
    app.destroy();
  });
});
