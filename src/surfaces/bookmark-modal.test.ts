// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBookmarkModal } from "./bookmark-modal";

describe("createBookmarkModal", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("creates an isolated, labelled dialog with large controls and plain text", () => {
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
    expect(shadow?.querySelector("style")?.textContent).toContain("min-height: 44px");
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

    const fields = shadow?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      "input, textarea",
    );
    if (!fields) throw new Error("Missing modal fields");
    fields[0]!.value = "research, ai";
    fields[1]!.value = "Reading / AI";
    fields[2]!.value = "Review the examples";
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
