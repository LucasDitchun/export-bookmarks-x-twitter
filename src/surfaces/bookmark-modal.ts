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
    font-family: Georgia, "Times New Roman", serif;
    font-size: 18px;
    line-height: 1.45;
    position: fixed;
    inset: 0;
    z-index: 2147483647;
  }
  :host([hidden]) { display: none; }
  *, *::before, *::after { box-sizing: border-box; }
  .backdrop {
    align-items: center;
    background: rgb(15 17 13 / 72%);
    display: flex;
    inset: 0;
    justify-content: center;
    padding: 24px;
    position: absolute;
  }
  .dialog {
    background: #fffef6;
    border: 2px solid #11120f;
    border-radius: 18px;
    box-shadow: 8px 8px 0 #11120f;
    color: #11120f;
    max-height: min(760px, calc(100vh - 48px));
    max-width: 620px;
    overflow: auto;
    padding: clamp(22px, 5vw, 38px);
    width: 100%;
  }
  .heading { align-items: start; display: flex; gap: 20px; justify-content: space-between; }
  h2 { font-size: clamp(1.6rem, 6vw, 2.35rem); line-height: 1.05; margin: 0; }
  .bookmark { border-left: 5px solid #caff4a; font-family: ui-monospace, monospace; margin: 18px 0 24px; padding-left: 14px; }
  .status { border: 2px solid #45483f; border-radius: 9px; margin: 0 0 18px; padding: 12px 14px; }
  .status[data-state="success"] { border-color: #16733d; }
  .status[data-state="error"] { border-color: #a52222; }
  label { display: block; font-weight: 700; margin-top: 18px; }
  input, textarea {
    background: white;
    border: 2px solid #45483f;
    border-radius: 9px;
    color: #11120f;
    display: block;
    font: inherit;
    margin-top: 7px;
    min-height: 44px;
    padding: 10px 12px;
    width: 100%;
  }
  textarea { min-height: 132px; resize: vertical; }
  button {
    background: #11120f;
    border: 2px solid #11120f;
    border-radius: 9px;
    color: white;
    cursor: pointer;
    font: 700 1rem/1 Georgia, serif;
    min-height: 44px;
    padding: 10px 18px;
  }
  .close { background: transparent; color: #11120f; flex: 0 0 auto; }
  .save { margin-top: 24px; width: 100%; }
  :focus-visible { outline: 4px solid #1769e0; outline-offset: 3px; }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; }
  }
`;

function appendLabelledInput(
  document: Document,
  form: HTMLFormElement,
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
  form.append(label, input);
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
  const tags = appendLabelledInput(
    document,
    form,
    "bookmark-x-modal-tags",
    options.labels.tags,
    options.values?.tags ?? "",
  );
  const folder = appendLabelledInput(
    document,
    form,
    "bookmark-x-modal-folder",
    options.labels.folder,
    options.values?.folder ?? "",
  );
  const descriptionLabel = document.createElement("label");
  descriptionLabel.htmlFor = "bookmark-x-modal-description";
  descriptionLabel.textContent = options.labels.description;
  const description = document.createElement("textarea");
  description.id = "bookmark-x-modal-description";
  description.maxLength = 20_000;
  description.value = options.values?.description ?? "";
  const saveButton = document.createElement("button");
  saveButton.className = "save";
  saveButton.type = "submit";
  saveButton.textContent = options.labels.save;
  form.append(descriptionLabel, description, saveButton);
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
    const focusable = [closeButton, tags, folder, description, saveButton];
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
