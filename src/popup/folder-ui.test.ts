// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BookmarkRecord, FolderRecord } from "../domain/types";
import type { SendMessage } from "./protocol";
import { createFolderUi } from "./folder-ui";

const popupHtml = readFileSync(resolve(process.cwd(), "popup.html"), "utf8");
const translate = (key: string, substitutions?: string | string[]): string => {
  const values = typeof substitutions === "string" ? [substitutions] : substitutions;
  return values?.length ? `${key}:${values.join("|")}` : key;
};

const folders: FolderRecord[] = [
  { id: "research", name: "Research", parentId: null },
  { id: "ai", name: "AI", parentId: "research" },
];

const bookmark: BookmarkRecord = {
  id: "123",
  text: "Useful",
  url: "https://x.com/person/status/123",
  author: { id: "person", username: "person", name: "Person" },
  postCreatedAt: "2026-01-01T00:00:00.000Z",
  media: { images: [], videos: [] },
  note: "Note",
  folderId: "ai",
  tagIds: ["tag-1"],
  firstSavedAt: "2026-01-02T00:00:00.000Z",
  lastSeenAt: "2026-01-02T00:00:00.000Z",
  archivedAt: null,
  metadataUpdatedAt: "2026-01-02T00:00:00.000Z",
  status: "current",
};

beforeEach(() => {
  document.open();
  document.write(popupHtml);
  document.close();
});

describe("folder UI", () => {
  it("renders a safe breadcrumb and assigns exactly one folder", async () => {
    const updated = { ...bookmark, folderId: null };
    const requests: string[] = [];
    const onBookmarkUpdated = vi.fn();
    const sendMessage = ((request) => {
      requests.push(request.type);
      if (request.type === "LIST_FOLDERS") {
        return Promise.resolve({ ok: true as const, data: { folders } });
      }
      if (request.type === "ASSIGN_BOOKMARK_FOLDER") {
        return Promise.resolve({
          ok: true as const,
          data: { bookmark: updated },
        });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const ui = createFolderUi({
      document,
      sendMessage,
      translate,
      onBookmarkUpdated,
    });
    await ui.ready;
    ui.setBookmark(bookmark);

    expect(document.getElementById("folder-breadcrumb-list")?.textContent).toBe(
      "ResearchAI",
    );
    const select = document.getElementById("folder-assignment") as HTMLSelectElement;
    expect(select.value).toBe("ai");
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => {
      expect(requests).toContain("ASSIGN_BOOKMARK_FOLDER");
      expect(onBookmarkUpdated).toHaveBeenCalledWith(updated);
    });
    expect(document.getElementById("folder-breadcrumb-list")?.textContent).toBe(
      "uncategorizedFolder",
    );
  });

  it("creates subfolders and safely renames and recursively deletes them", async () => {
    let currentFolders = [...folders];
    const requests: string[] = [];
    const sendMessage = ((request) => {
      requests.push(request.type);
      if (request.type === "LIST_FOLDERS") {
        return Promise.resolve({
          ok: true as const,
          data: { folders: currentFolders },
        });
      }
      if (request.type === "CREATE_FOLDER") {
        const folder = {
          id: "models",
          name: request.payload.name.trim(),
          parentId: request.payload.parentId,
        };
        currentFolders = [...currentFolders, folder];
        return Promise.resolve({ ok: true as const, data: { folder } });
      }
      if (request.type === "RENAME_FOLDER") {
        const folder = {
          ...currentFolders.find(({ id }) => id === request.payload.id)!,
          name: request.payload.name.trim(),
        };
        currentFolders = currentFolders.map((item) =>
          item.id === folder.id ? folder : item,
        );
        return Promise.resolve({ ok: true as const, data: { folder } });
      }
      if (request.type === "DELETE_FOLDER") {
        currentFolders = currentFolders.filter(
          ({ id }) => id !== "models" && id !== "ai",
        );
        return Promise.resolve({
          ok: true as const,
          data: {
            deletedFolderIds: ["ai", "models"],
            uncategorizedBookmarkCount: 1,
          },
        });
      }
      return Promise.resolve({ ok: true as const, data: undefined });
    }) as SendMessage;
    const ui = createFolderUi({
      document,
      sendMessage,
      translate,
      onBookmarkUpdated: vi.fn(),
    });
    await ui.ready;
    ui.setBookmark(bookmark);

    const name = document.getElementById("folder-name") as HTMLInputElement;
    const parent = document.getElementById("folder-parent") as HTMLSelectElement;
    name.value = "  Models  ";
    parent.value = "ai";
    document
      .getElementById("create-folder-form")
      ?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(document.getElementById("folder-list")?.textContent).toContain("Models"),
    );

    const rename = document.querySelector<HTMLButtonElement>(
      '[data-folder-action="rename"][data-folder-id="models"]',
    );
    rename?.click();
    const renameInput = document.querySelector<HTMLInputElement>(
      '[data-folder-rename-input="models"]',
    );
    expect(renameInput?.getAttribute("aria-label")).toContain("Models");
    if (renameInput) renameInput.value = "LLM models";
    document
      .querySelector<HTMLFormElement>('[data-folder-rename-form="models"]')
      ?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(document.getElementById("folder-list")?.textContent).toContain(
        "LLM models",
      ),
    );

    const remove = document.querySelector<HTMLButtonElement>(
      '[data-folder-action="delete"][data-folder-id="ai"]',
    );
    remove?.click();
    expect(document.querySelector('[data-folder-delete-confirm="ai"]')).not.toBeNull();
    document
      .querySelector<HTMLButtonElement>('[data-folder-delete-confirm="ai"]')
      ?.click();
    await vi.waitFor(() => {
      expect(requests).toContain("DELETE_FOLDER");
      expect(document.getElementById("folder-list")?.textContent).not.toContain(
        "LLM models",
      );
    });
  });
});
