export interface BookmarkModalLabels {
  close: string;
  description: string;
  folder: string;
  save: string;
  tags: string;
  tagsHelp?: string;
  pending?: string;
}

export interface BookmarkModalValues {
  description: string;
  folder: string;
  tags: string;
}

export interface BookmarkModalChoices {
  folders: string[];
  tags: string[];
}

export interface BookmarkModalOptions {
  document: Document;
  title: string;
  bookmarkTitle: string;
  labels: BookmarkModalLabels;
  values?: Partial<BookmarkModalValues>;
  onClose?: () => void;
  onSave?: (values: BookmarkModalValues) => boolean | void | Promise<boolean | void>;
}

export interface BookmarkModalController {
  host: HTMLElement;
  open(): void;
  close(): void;
  destroy(): void;
  setValues(values: Partial<BookmarkModalValues>): void;
  setChoices(choices: Partial<BookmarkModalChoices>): void;
  setState(state: "pending" | "ready" | "success" | "error", message: string): void;
}

const MODAL_STYLES = `
  :host {
    all: initial;
    --modal-bg: #fff;
    --modal-subtle: #f7f9f9;
    --modal-text: #0f1419;
    --modal-muted: #536471;
    --modal-line: #cfd9de;
    --modal-action: #0f1419;
    --modal-action-text: #fff;
    color-scheme: light dark;
    font-family: "Segoe UI Variable Text", "Helvetica Neue", Helvetica, sans-serif;
    font-size: 15px;
    line-height: 1.4;
    position: fixed;
    inset: 0;
    z-index: 2147483647;
  }
  :host([data-theme="dark"]) {
    --modal-bg: #000;
    --modal-subtle: #16181c;
    --modal-text: #e7e9ea;
    --modal-muted: #8b98a5;
    --modal-line: #2f3336;
    --modal-action: #eff3f4;
    --modal-action-text: #0f1419;
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
    background: var(--modal-bg);
    border: 1px solid var(--modal-line);
    border-radius: 20px;
    box-shadow: 0 20px 64px rgb(15 20 25 / 24%);
    color: var(--modal-text);
    max-height: min(680px, calc(100vh - 32px));
    max-width: 480px;
    overflow: auto;
    padding: 20px;
    width: 100%;
  }
  .heading { align-items: start; display: flex; gap: 12px; justify-content: space-between; }
  h2 { font-size: 1.25rem; letter-spacing: -0.02em; line-height: 1.2; margin: 0; }
  .bookmark {
    background: var(--modal-subtle);
    border-radius: 12px;
    color: var(--modal-muted);
    font-size: 0.875rem;
    margin: 14px 0;
    max-height: 84px;
    overscroll-behavior: contain;
    overflow-y: auto;
    overflow-wrap: anywhere;
    padding: 10px 12px;
    scrollbar-gutter: stable;
    white-space: pre-wrap;
  }
  .status { border: 1px solid var(--modal-line); border-radius: 12px; margin: 0 0 14px; padding: 10px 12px; }
  .status[data-state="success"] { border-color: #16733d; }
  .status[data-state="error"] { border-color: #a52222; }
  form { display: grid; gap: 12px; }
  form[hidden] { display: none; }
  label { color: var(--modal-muted); display: block; font-size: 0.8125rem; font-weight: 700; }
  .field-help {
    color: var(--modal-muted);
    font-size: 0.75rem;
    line-height: 1.35;
    margin: 6px 2px 0;
  }
  .metadata-grid { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .field { min-width: 0; }
  input, select, textarea {
    background: var(--modal-bg);
    border: 1px solid var(--modal-line);
    border-radius: 12px;
    color: var(--modal-text);
    display: block;
    font: inherit;
    margin-top: 5px;
    min-height: 44px;
    padding: 10px 12px;
    width: 100%;
  }
  textarea {
    height: 120px;
    max-height: 120px;
    min-height: 120px;
    overflow-y: auto;
    resize: none;
  }
  button {
    background: var(--modal-action);
    border: 1px solid var(--modal-action);
    border-radius: 999px;
    color: var(--modal-action-text);
    cursor: pointer;
    font: 700 0.875rem/1 "Segoe UI Variable Text", "Helvetica Neue", Helvetica, sans-serif;
    min-height: 44px;
    padding: 10px 18px;
  }
  .close { background: transparent; color: var(--modal-text); flex: 0 0 auto; }
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

function usesDarkTheme(document: Document): boolean {
  const view = document.defaultView;
  for (const element of [document.body, document.documentElement]) {
    if (!element || !view) continue;
    const values = view
      .getComputedStyle(element)
      .backgroundColor.match(/[\d.]+/g)
      ?.map(Number);
    if (!values || values.length < 3 || (values[3] ?? 1) === 0) continue;
    const red = values[0] ?? 255;
    const green = values[1] ?? 255;
    const blue = values[2] ?? 255;
    return red * 0.2126 + green * 0.7152 + blue * 0.0722 < 128;
  }
  return view?.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

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
  host.dataset.theme = usesDarkTheme(document) ? "dark" : "light";
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
  const tagChoices = document.createElement("datalist");
  tagChoices.id = "bookmark-x-modal-tag-choices";
  tags.setAttribute("list", tagChoices.id);
  if (options.labels.tagsHelp) {
    const tagsHelp = document.createElement("p");
    tagsHelp.className = "field-help";
    tagsHelp.id = "bookmark-x-modal-tags-help";
    tagsHelp.textContent = options.labels.tagsHelp;
    tags.setAttribute("aria-describedby", tagsHelp.id);
    tags.parentElement?.append(tagsHelp);
  }
  const folder = appendLabelledInput(
    document,
    metadataGrid,
    "bookmark-x-modal-folder",
    options.labels.folder,
    options.values?.folder ?? "",
  );
  const folderChoices = document.createElement("datalist");
  folderChoices.id = "bookmark-x-modal-folder-choices";
  folder.setAttribute("list", folderChoices.id);
  const saveButton = document.createElement("button");
  saveButton.className = "save";
  saveButton.type = "submit";
  saveButton.textContent = options.labels.save;
  form.append(metadataGrid, tagChoices, folderChoices, saveButton);
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
    const focusable = Array.from(
      shadow.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
      ),
    ).filter((element) => !element.hidden);
    const active = shadow.activeElement;
    if (event.shiftKey && active === focusable[0]) {
      event.preventDefault();
      focusable.at(-1)?.focus();
    } else if (!event.shiftKey && active === focusable.at(-1)) {
      event.preventDefault();
      focusable[0]?.focus();
    }
  });
  let submitting = false;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (submitting) return;
    submitting = true;
    saveButton.disabled = true;
    void Promise.resolve(
      options.onSave?.({
        description: description.value,
        folder: folder.value,
        tags: tags.value,
      }),
    )
      .then((saved) => {
        if (saved !== false) close();
      })
      .catch(() => undefined)
      .finally(() => {
        submitting = false;
        if (!host.hidden) saveButton.disabled = false;
      });
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
    setChoices(choices) {
      const replaceOptions = (
        target: HTMLDataListElement,
        values: readonly string[] | undefined,
      ): void => {
        if (!values) return;
        target.replaceChildren(
          ...[...new Set(values)].map((value) => {
            const option = document.createElement("option");
            option.value = value;
            return option;
          }),
        );
      };
      replaceOptions(tagChoices, choices.tags);
      replaceOptions(folderChoices, choices.folders);
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
