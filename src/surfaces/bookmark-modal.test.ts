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
    expect(styles).not.toContain("font-family: Georgia");
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

  it("submits plain values and keeps keyboard focus inside the dialog", async () => {
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
    tags.value = "research, ai";
    folder.value = "Reading / AI";
    description.value = "Review the examples";
    shadow
      ?.querySelector("form")
      ?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        tags: "research, ai",
        folder: "Reading / AI",
        description: "Review the examples",
      }),
    );

    shadow?.querySelector<HTMLElement>(".backdrop")?.click();
    expect(modal.host.hidden).toBe(true);
    modal.destroy();
  });
});
