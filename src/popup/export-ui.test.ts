// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExportResult, RuntimeResponse, UiRequest } from "../shared/protocol";
import { createExportUi } from "./export-ui";

const popupHtml = readFileSync(resolve(process.cwd(), "popup.html"), "utf8");
const translate = (key: string): string => key;

beforeEach(() => {
  document.open();
  document.write(popupHtml);
  document.close();
});

describe("export UI", () => {
  it("exports TXT by default with folder-subtree, tag OR, and archived filters", async () => {
    const requests: UiRequest[] = [];
    const download = vi.fn();
    const perform = vi.fn(
      async (
        request: UiRequest,
        afterSuccess?: (data: unknown) => void | Promise<void>,
      ) => {
        requests.push(request);
        await afterSuccess?.({ content: "file", filename: "library.txt" });
      },
    );
    const ui = createExportUi({
      document,
      locale: "en",
      translate,
      perform,
      createDownload: download,
    });
    ui.setFolders([
      { id: "root", name: "Work", parentId: null },
      { id: "child", name: "Reading", parentId: "root" },
    ]);
    ui.setTags([
      { id: "tag-a", name: "AI", normalizedName: "ai" },
      { id: "tag-b", name: "Design", normalizedName: "design" },
    ]);
    const folder = document.getElementById("export-folder-filter") as HTMLSelectElement;
    const tags = document.getElementById("export-tag-filter") as HTMLSelectElement;
    folder.value = "root";
    tags.options[0]!.selected = true;
    tags.options[1]!.selected = true;
    (document.getElementById("export-include-archived") as HTMLInputElement).checked =
      false;
    (document.getElementById("export-primary-button") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());

    expect(requests).toEqual([
      {
        type: "EXPORT_BOOKMARKS",
        payload: {
          format: "txt",
          locale: "en",
          folderId: "root",
          tagIds: ["tag-a", "tag-b"],
          includeArchived: false,
        },
      },
    ]);
    expect(download).toHaveBeenCalledWith({
      content: "file",
      filename: "library.txt",
    });
    expect(document.getElementById("export-status")?.textContent).toBe(
      "exportDownloaded",
    );
    ui.destroy();
  });

  it("opens the format menu with the keyboard, wraps focus, and exports Markdown", async () => {
    const requests: UiRequest[] = [];
    const perform = vi.fn(
      async (
        request: UiRequest,
        afterSuccess?: (data: unknown) => void | Promise<void>,
      ) => {
        requests.push(request);
        await afterSuccess?.({ content: "# file", filename: "library.md" });
      },
    );
    const ui = createExportUi({
      document,
      locale: "pt_BR",
      translate,
      perform,
      createDownload: vi.fn(),
    });
    const toggle = document.getElementById("export-menu-button") as HTMLButtonElement;
    toggle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    const menu = document.getElementById("export-format-menu")!;
    const items = menu.querySelectorAll<HTMLButtonElement>("[role='menuitem']");

    expect(menu.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(items[0]);
    items[0]!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
    );
    expect(document.activeElement).toBe(items[1]);
    items[1]!.click();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({
      type: "EXPORT_BOOKMARKS",
      payload: { format: "md", locale: "pt_BR" },
    });
    expect(menu.hidden).toBe(true);
    ui.destroy();
  });

  it("announces the zero-field error without exposing diagnostics", async () => {
    const perform = vi.fn(
      async (
        _request: UiRequest,
        _afterSuccess?: (data: unknown) => void | Promise<void>,
        afterError?: (
          error: Extract<RuntimeResponse<never>, { ok: false }>["error"],
        ) => void | Promise<void>,
      ) => {
        await afterError?.({
          code: "export_fields_required",
          message: "private diagnostic",
        });
      },
    );
    const ui = createExportUi({
      document,
      locale: "en",
      translate,
      perform,
      createDownload: vi.fn<(result: ExportResult) => void>(),
    });
    (document.getElementById("export-primary-button") as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(document.getElementById("export-status")?.textContent).toBe(
        "exportFieldRequired",
      ),
    );
    expect(document.body.textContent).not.toContain("private diagnostic");
    ui.destroy();
  });
});
