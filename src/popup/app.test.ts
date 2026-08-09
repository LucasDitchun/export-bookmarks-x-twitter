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
  },
};

const libraryBookmark: NotedBookmark = {
  id: "123",
  text: "A useful bookmark",
  url: "https://x.com/person/status/123",
  author: { id: "person", username: "person", name: "Person" },
  postCreatedAt: "2026-07-29T09:00:00.000Z",
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
  it("lists current bookmarks and opens the selected note in a safe editor", async () => {
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
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const app = createPopupApp({ document, locale: "en", sendMessage, translate });
    await app.ready;

    expect(requests).toContain("LIST_BOOKMARKS");
    expect(requests).toContain("GET_BOOKMARK");
    expect(document.getElementById("bookmark-list")?.textContent).toContain(
      "A useful bookmark",
    );
    expect(
      (document.getElementById("note-textarea") as HTMLTextAreaElement).value,
    ).toBe("Read this again");
    expect(document.getElementById("selected-bookmark-title")?.textContent).toBe(
      "A useful bookmark",
    );
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
      "captureComplete",
    );
    document.getElementById("capture-button")?.click();
    await vi.waitFor(() => expect(requests).toContain("START_SCRAPE"));
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
    expect(scheduled.filter((item) => item.delay === 1_000)).toHaveLength(1);
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

    document.getElementById("export-full-button")?.click();
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
});
