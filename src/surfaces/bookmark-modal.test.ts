// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBookmarkModal } from "./bookmark-modal";

describe("createBookmarkModal", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("creates a compact isolated dialog that prioritizes the private note", () => {
    const modal = createBookmarkModal({
      document,
      title: "Why are you saving this?",
      bookmarkTitle: "<img src=x onerror=alert(1)>",
      labels: {
        close: "Close",
        description: "Private note",
        folder: "Folder",
        save: "Save note",
        tags: "Tags",
        tagsHelp: "Press Enter after each tag.",
      },
    });
    modal.open();

    const host = document.querySelector("bookmark-x-note-modal");
    const shadow = host?.shadowRoot;
    const dialog = shadow?.querySelector<HTMLElement>("[role=dialog]");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(shadow?.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(shadow?.querySelector("img")).toBeNull();
    expect(shadow?.querySelector("textarea")?.getAttribute("maxlength")).toBe("20000");
    const styles = shadow?.querySelector("style")?.textContent ?? "";
    expect(styles).toContain("min-height: 44px");
    expect(styles).toContain("font-size: 15px");
    expect(styles).toContain("max-width: 480px");
    expect(styles).toContain("max-height: 84px");
    expect(styles).toContain("overflow-y: auto");
    expect(styles).not.toContain("font-family: Georgia");
    modal.setChoices({
      folders: [
        { id: "folder-ai", path: ["Reading", "AI"] },
        { id: "folder-design", path: ["Reading", "Design"] },
      ],
      tags: [
        { id: "tag-research", name: "research" },
        { id: "tag-accessibility", name: "accessibility" },
      ],
    });
    expect(
      Array.from(
        shadow?.querySelectorAll("#bookmark-x-modal-folder-choices option") ?? [],
        (option) => option.getAttribute("value"),
      ),
    ).toEqual(["Reading / AI", "Reading / Design"]);
    expect(
      Array.from(
        shadow?.querySelectorAll("#bookmark-x-modal-tag-choices option") ?? [],
        (option) => option.getAttribute("value"),
      ),
    ).toEqual(["research", "accessibility"]);
    expect(
      shadow?.querySelector("#bookmark-x-modal-folder")?.getAttribute("list"),
    ).toBe("bookmark-x-modal-folder-choices");
    expect(shadow?.querySelector("#bookmark-x-modal-tags")?.getAttribute("list")).toBe(
      "bookmark-x-modal-tag-choices",
    );
    expect(
      shadow?.querySelector("#bookmark-x-modal-tags")?.getAttribute("aria-describedby"),
    ).toBe("bookmark-x-modal-tags-help");
    expect(shadow?.querySelector("#bookmark-x-modal-tags-help")?.textContent).toBe(
      "Press Enter after each tag.",
    );
    expect(shadow?.querySelectorAll(".choice-select")).toHaveLength(0);
    const description = shadow?.querySelector("#bookmark-x-modal-description");
    const tags = shadow?.querySelector("#bookmark-x-modal-tags");
    expect(
      description && tags
        ? Boolean(
            description.compareDocumentPosition(tags) &
            Node.DOCUMENT_POSITION_FOLLOWING,
          )
        : false,
    ).toBe(true);
    expect(document.activeElement).toBe(host);
  });

  it("closes with Escape, restores focus, and can be destroyed safely", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const modal = createBookmarkModal({
      document,
      title: "Bookmark note",
      bookmarkTitle: "A useful post",
      labels: {
        close: "Close",
        description: "Private note",
        folder: "Folder",
        save: "Save note",
        tags: "Tags",
      },
      onClose,
    });

    modal.open();
    modal.host.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(onClose).toHaveBeenCalledOnce();
    expect(modal.host.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    modal.destroy();
    expect(document.body.contains(modal.host)).toBe(false);
  });

  it("keeps metadata fields visually hidden while X is confirming the action", () => {
    const modal = createBookmarkModal({
      document,
      title: "Bookmark note",
      bookmarkTitle: "A useful post",
      labels: {
        close: "Close",
        description: "Private note",
        folder: "Folder",
        pending: "Waiting for X",
        save: "Save note",
        tags: "Tags",
      },
    });
    modal.open();

    const form = modal.host.shadowRoot?.querySelector("form");
    expect(form?.hidden).toBe(true);
    expect(form ? getComputedStyle(form).display : null).toBe("none");
    modal.destroy();
  });

  it("relabels an open dialog without replacing its entered values", () => {
    const modal = createBookmarkModal({
      document,
      title: "Why are you saving this?",
      bookmarkTitle: "A useful post",
      labels: {
        close: "Close",
        description: "Private note",
        folder: "Folder",
        save: "Save note",
        tags: "Tags",
        tagsHelp: "Press Enter after each tag.",
      },
    });
    modal.open();
    const shadow = modal.host.shadowRoot;
    const note = shadow?.querySelector<HTMLTextAreaElement>(
      "#bookmark-x-modal-description",
    );
    if (!note) throw new Error("Missing note field");
    note.value = "Do not lose this draft";

    modal.setLabels({
      title: "Por que você está salvando isto?",
      labels: {
        close: "Fechar",
        description: "Nota privada",
        folder: "Pasta",
        save: "Salvar nota",
        tags: "Tags",
        tagsHelp: "Pressione Enter após cada tag.",
      },
    });

    expect(shadow?.querySelector("h2")?.textContent).toBe(
      "Por que você está salvando isto?",
    );
    expect(shadow?.querySelector(".close")?.textContent).toBe("Fechar");
    expect(
      shadow?.querySelector('label[for="bookmark-x-modal-folder"]')?.textContent,
    ).toBe("Pasta");
    expect(shadow?.querySelector(".save")?.textContent).toBe("Salvar nota");
    expect(note.value).toBe("Do not lose this draft");
    modal.destroy();
  });

  it("submits existing and new structured tokens without splitting delimiters", async () => {
    const onSave = vi.fn(async () => undefined);
    const modal = createBookmarkModal({
      document,
      title: "Bookmark note",
      bookmarkTitle: "A useful post",
      labels: {
        close: "Close",
        description: "Private note",
        folder: "Folder",
        save: "Save note",
        tags: "Tags",
      },
      values: {
        description: "",
        tags: [{ id: "tag-ai", name: "AI, ML" }],
        folder: { id: "folder-video", path: ["R&D/Video"] },
      },
      onSave,
    });
    modal.setChoices({
      tags: [{ id: "tag-ai", name: "AI, ML" }],
      folders: [{ id: "folder-video", path: ["R&D/Video"] }],
    });
    modal.open();
    const shadow = modal.host.shadowRoot;
    const close = shadow?.querySelector<HTMLButtonElement>(".close");
    close?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        composed: true,
      }),
    );
    expect(shadow?.activeElement).toBe(shadow?.querySelector(".save"));

    const tags = shadow?.querySelector<HTMLInputElement>("#bookmark-x-modal-tags");
    const folder = shadow?.querySelector<HTMLInputElement>("#bookmark-x-modal-folder");
    const description = shadow?.querySelector<HTMLTextAreaElement>(
      "#bookmark-x-modal-description",
    );
    if (!tags || !folder || !description) throw new Error("Missing modal fields");
    tags.value = "New, exact";
    tags.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(shadow?.querySelector(".folder-token")?.textContent).toContain("R&D/Video");
    description.value = "Review the examples";
    shadow
      ?.querySelector("form")
      ?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        tags: [
          { id: "tag-ai", name: "AI, ML" },
          { id: null, name: "New, exact" },
        ],
        folder: { id: "folder-video", path: ["R&D/Video"] },
        description: "Review the examples",
      }),
    );
    await vi.waitFor(() => expect(modal.host.hidden).toBe(true));
    modal.destroy();
  });

  it("keeps the dialog open when saving fails", async () => {
    const modal = createBookmarkModal({
      document,
      title: "Bookmark note",
      bookmarkTitle: "A useful post",
      labels: {
        close: "Close",
        description: "Private note",
        folder: "Folder",
        save: "Save note",
        tags: "Tags",
      },
      onSave: async () => false,
    });
    modal.open();

    modal.host.shadowRoot
      ?.querySelector("form")
      ?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(
        modal.host.shadowRoot?.querySelector<HTMLButtonElement>(".save")?.disabled,
      ).toBe(false),
    );
    expect(modal.host.hidden).toBe(false);
    modal.destroy();
  });

  it("keeps a new folder name containing a slash as one structured segment", async () => {
    const onSave = vi.fn(async () => undefined);
    const modal = createBookmarkModal({
      document,
      title: "Bookmark note",
      bookmarkTitle: "A useful post",
      labels: {
        close: "Close",
        description: "Private note",
        folder: "Folder",
        save: "Save note",
        tags: "Tags",
      },
      onSave,
    });
    modal.open();
    const shadow = modal.host.shadowRoot;
    const folder = shadow?.querySelector<HTMLInputElement>("#bookmark-x-modal-folder");
    if (!folder) throw new Error("Missing folder field");
    folder.value = "R&D/Video";
    folder.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    shadow
      ?.querySelector("form")
      ?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        description: "",
        tags: [],
        folder: { id: null, path: ["R&D/Video"] },
      }),
    );
    modal.destroy();
  });

  it("keeps an existing folder ID when appending a new child segment", async () => {
    const onSave = vi.fn(async () => undefined);
    const modal = createBookmarkModal({
      document,
      title: "Bookmark note",
      bookmarkTitle: "A useful post",
      labels: {
        close: "Close",
        description: "Private note",
        folder: "Folder",
        save: "Save note",
        tags: "Tags",
      },
      onSave,
    });
    modal.setChoices({
      folders: [{ id: "folder-ai", path: ["Reading", "AI"] }],
    });
    modal.open();
    const shadow = modal.host.shadowRoot;
    const folder = shadow?.querySelector<HTMLInputElement>(
      "#bookmark-x-modal-folder",
    );
    if (!folder) throw new Error("Missing folder field");

    folder.value = "Reading / AI";
    folder.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    folder.value = "Deep learning";
    folder.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    shadow
      ?.querySelector("form")
      ?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        description: "",
        tags: [],
        folder: {
          id: "folder-ai",
          path: ["Reading", "AI", "Deep learning"],
          newSegments: ["Deep learning"],
        },
      }),
    );
    modal.destroy();
  });
});
