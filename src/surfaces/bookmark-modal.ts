export interface BookmarkModalLabels {
  close: string;
  description: string;
  folder: string;
  save: string;
  tags: string;
  pending?: string;
}

export interface BookmarkModalValues {
  description: string;
  folder: string;
  tags: string;
}

export interface BookmarkModalOptions {
  document: Document;
  title: string;
  bookmarkTitle: string;
  labels: BookmarkModalLabels;
  values?: Partial<BookmarkModalValues>;
  onClose?: () => void;
  onSave?: (values: BookmarkModalValues) => void | Promise<void>;
}

export interface BookmarkModalController {
  host: HTMLElement;
  open(): void;
  close(): void;
  destroy(): void;
  setValues(values: Partial<BookmarkModalValues>): void;
  setState(state: "pending" | "ready" | "success" | "error", message: string): void;
}

const MODAL_STYLES = `
  :host {
    all: initial;
    color-scheme: light;
    font-family: "Segoe UI Variable Text", "Helvetica Neue", Helvetica, sans-serif;
    font-size: 15px;
    line-height: 1.4;
    position: fixed;
    inset: 0;
    z-index: 2147483647;
  }
  :host([hidden]) { display: none; }
  *, *::before, *::after { box-sizing: border-box; }
  .backdrop {
    align-items: center;
    background: rgb(15 20 25 / 48%);
    display: flex;
    inset: 0;
    justify-content: center;
    padding: 16px;
    position: absolute;
  }
  .dialog {
    background: #fff;
    border: 1px solid #cfd9de;
    border-radius: 20px;
    box-shadow: 0 20px 64px rgb(15 20 25 / 24%);
    color: #0f1419;
    max-height: min(680px, calc(100vh - 32px));
    max-width: 480px;
    overflow: auto;
    padding: 20px;
    width: 100%;
  }
  .heading { align-items: start; display: flex; gap: 12px; justify-content: space-between; }
  h2 { font-size: 1.25rem; letter-spacing: -0.02em; line-height: 1.2; margin: 0; }
  .bookmark {
    background: #f7f9f9;
    border-radius: 12px;
    color: #536471;
    display: -webkit-box;
    font-size: 0.875rem;
    margin: 14px 0;
    overflow: hidden;
    overflow-wrap: anywhere;
    padding: 10px 12px;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
  .status { border: 1px solid #cfd9de; border-radius: 12px; margin: 0 0 14px; padding: 10px 12px; }
  .status[data-state="success"] { border-color: #16733d; }
  .status[data-state="error"] { border-color: #a52222; }
  form { display: grid; gap: 12px; }
  form[hidden] { display: none; }
  label { color: #536471; display: block; font-size: 0.8125rem; font-weight: 700; }
  .metadata-grid { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .field { min-width: 0; }
  input, textarea {
    background: white;
    border: 1px solid #cfd9de;
    border-radius: 12px;
    color: #0f1419;
    display: block;
    font: inherit;
    margin-top: 5px;
    min-height: 44px;
    padding: 10px 12px;
    width: 100%;
  }
  textarea { min-height: 112px; resize: vertical; }
  button {
    background: #0f1419;
    border: 1px solid #0f1419;
    border-radius: 999px;
    color: white;
    cursor: pointer;
    font: 700 0.875rem/1 "Segoe UI Variable Text", "Helvetica Neue", Helvetica, sans-serif;
    min-height: 44px;
    padding: 10px 18px;
  }
  .close { background: transparent; color: #0f1419; flex: 0 0 auto; }
  .save { margin-top: 2px; width: 100%; }
  :focus-visible { outline: 3px solid #1d9bf0; outline-offset: 2px; }
  @media (max-width: 520px) {
    .backdrop { align-items: end; padding: 8px; }
    .dialog { border-radius: 20px 20px 12px 12px; max-height: calc(100vh - 16px); padding: 18px; }
    .metadata-grid { grid-template-columns: 1fr; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; }
  }
`;

function appendLabelledInput(
  document: Document,
  container: HTMLElement,
  id: string,
  labelText: string,
  value: string,
): HTMLInputElement {
  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = labelText;
  const input = document.createElement("input");
  input.id = id;
  input.value = value;
  input.autocomplete = "off";
  const field = document.createElement("div");
  field.className = "field";
  field.append(label, input);
  container.append(field);
  return input;
}

export function createBookmarkModal(
  options: BookmarkModalOptions,
): BookmarkModalController {
  const { document } = options;
  const host = document.createElement("bookmark-x-note-modal");
  host.hidden = true;
  host.tabIndex = -1;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = MODAL_STYLES;

  const backdrop = document.createElement("div");
  backdrop.className = "backdrop";
  const dialog = document.createElement("section");
  dialog.className = "dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "bookmark-x-modal-title");

  const heading = document.createElement("div");
  heading.className = "heading";
  const title = document.createElement("h2");
  title.id = "bookmark-x-modal-title";
  title.textContent = options.title;
  const closeButton = document.createElement("button");
  closeButton.className = "close";
  closeButton.type = "button";
  closeButton.textContent = options.labels.close;
  heading.append(title, closeButton);

  const bookmark = document.createElement("p");
  bookmark.className = "bookmark";
  bookmark.textContent = options.bookmarkTitle;

  const status = document.createElement("p");
  status.className = "status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  status.dataset.state = options.labels.pending ? "pending" : "ready";
  status.textContent = options.labels.pending ?? "";
  status.hidden = status.textContent.length === 0;

  const form = document.createElement("form");
  const descriptionLabel = document.createElement("label");
  descriptionLabel.htmlFor = "bookmark-x-modal-description";
  descriptionLabel.textContent = options.labels.description;
  const description = document.createElement("textarea");
  description.id = "bookmark-x-modal-description";
  description.maxLength = 20_000;
  description.value = options.values?.description ?? "";
  form.append(descriptionLabel, description);

  const metadataGrid = document.createElement("div");
  metadataGrid.className = "metadata-grid";
  const tags = appendLabelledInput(
    document,
    metadataGrid,
    "bookmark-x-modal-tags",
    options.labels.tags,
    options.values?.tags ?? "",
  );
  const folder = appendLabelledInput(
    document,
    metadataGrid,
    "bookmark-x-modal-folder",
    options.labels.folder,
    options.values?.folder ?? "",
  );
  const saveButton = document.createElement("button");
  saveButton.className = "save";
  saveButton.type = "submit";
  saveButton.textContent = options.labels.save;
  form.append(metadataGrid, saveButton);
  form.hidden = options.labels.pending !== undefined;
  dialog.append(heading, bookmark, status, form);
  backdrop.append(dialog);
  shadow.append(style, backdrop);
  document.body.append(host);

  let returnFocus: HTMLElement | null = null;

  const close = (): void => {
    if (host.hidden) return;
    host.hidden = true;
    options.onClose?.();
    returnFocus?.focus();
  };

  closeButton.addEventListener("click", close);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  host.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [closeButton, description, tags, folder, saveButton];
    const active = shadow.activeElement;
    if (event.shiftKey && active === focusable[0]) {
      event.preventDefault();
      focusable.at(-1)?.focus();
    } else if (!event.shiftKey && active === focusable.at(-1)) {
      event.preventDefault();
      focusable[0]?.focus();
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void Promise.resolve(
      options.onSave?.({
        description: description.value,
        folder: folder.value,
        tags: tags.value,
      }),
    ).catch(() => undefined);
  });

  return {
    host,
    open() {
      const active = document.activeElement;
      returnFocus = active instanceof HTMLElement ? active : null;
      host.hidden = false;
      closeButton.focus();
    },
    close,
    setValues(values) {
      if (values.tags !== undefined) tags.value = values.tags;
      if (values.folder !== undefined) folder.value = values.folder;
      if (values.description !== undefined) description.value = values.description;
    },
    setState(state, message) {
      status.dataset.state = state;
      status.textContent = message;
      status.hidden = message.length === 0;
      form.hidden = state !== "ready";
    },
    destroy() {
      host.remove();
    },
  };
}
