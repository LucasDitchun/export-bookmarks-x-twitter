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
  folder: BookmarkModalFolderToken | null;
  tags: BookmarkModalTagToken[];
}

export interface BookmarkModalTagToken {
  id: string | null;
  name: string;
}

export interface BookmarkModalFolderToken {
  id: string | null;
  path: string[];
}

export interface BookmarkModalChoices {
  folders: Array<BookmarkModalFolderToken & { id: string }>;
  tags: Array<BookmarkModalTagToken & { id: string }>;
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
  setLabels(labels: { title: string; labels: BookmarkModalLabels }): void;
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
  .tokens { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
  .token {
    align-items: center;
    background: var(--modal-subtle);
    border: 1px solid var(--modal-line);
    color: var(--modal-text);
    display: inline-flex;
    font-size: 0.75rem;
    min-height: 30px;
    padding: 5px 9px;
  }
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
    "",
  );
  const tagsFieldLabel = tags.parentElement?.querySelector("label");
  const selectedTagList = document.createElement("div");
  selectedTagList.className = "tokens";
  tags.parentElement?.append(selectedTagList);
  const tagChoices = document.createElement("datalist");
  tagChoices.id = "bookmark-x-modal-tag-choices";
  tags.setAttribute("list", tagChoices.id);
  const tagsHelp = document.createElement("p");
  tagsHelp.className = "field-help";
  tagsHelp.id = "bookmark-x-modal-tags-help";
  tagsHelp.textContent = options.labels.tagsHelp ?? "";
  tagsHelp.hidden = !options.labels.tagsHelp;
  tags.setAttribute("aria-describedby", tagsHelp.id);
  tags.parentElement?.append(tagsHelp);
  const folder = appendLabelledInput(
    document,
    metadataGrid,
    "bookmark-x-modal-folder",
    options.labels.folder,
    "",
  );
  const folderFieldLabel = folder.parentElement?.querySelector("label");
  const selectedFolderList = document.createElement("div");
  selectedFolderList.className = "tokens folder-tokens";
  folder.parentElement?.append(selectedFolderList);
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
  let selectedTags = [...(options.values?.tags ?? [])];
  let selectedFolder = options.values?.folder ?? null;
  let availableTags: BookmarkModalChoices["tags"] = [];
  let availableFolders: BookmarkModalChoices["folders"] = [];

  const comparable = (value: string): string =>
    value.trim().normalize("NFKC").toLocaleLowerCase("und");
  const formatFolderLabel = (value: BookmarkModalFolderToken): string =>
    value.path.join(" / ");
  const renderSelectedFolder = (): void => {
    selectedFolderList.replaceChildren();
    if (!selectedFolder) return;
    const token = document.createElement("button");
    token.className = "token folder-token";
    token.type = "button";
    token.textContent = `${formatFolderLabel(selectedFolder)} ×`;
    token.setAttribute("aria-label", `Remove ${formatFolderLabel(selectedFolder)}`);
    token.addEventListener("click", () => {
      selectedFolder = null;
      renderSelectedFolder();
      folder.focus();
    });
    selectedFolderList.append(token);
  };
  const renderSelectedTags = (): void => {
    selectedTagList.replaceChildren(
      ...selectedTags.map((tag) => {
        const token = document.createElement("button");
        token.className = "token";
        token.type = "button";
        token.textContent = `${tag.name} ×`;
        token.setAttribute("aria-label", `Remove ${tag.name}`);
        token.addEventListener("click", () => {
          selectedTags = selectedTags.filter((candidate) => candidate !== tag);
          renderSelectedTags();
          tags.focus();
        });
        return token;
      }),
    );
  };
  const addPendingTag = (): void => {
    const name = tags.value.trim().normalize("NFKC");
    if (!name) return;
    const existing = availableTags.find(
      (candidate) => comparable(candidate.name) === comparable(name),
    );
    const token: BookmarkModalTagToken = existing ?? { id: null, name };
    if (
      !selectedTags.some((candidate) => comparable(candidate.name) === comparable(name))
    ) {
      selectedTags = [...selectedTags, token];
      renderSelectedTags();
    }
    tags.value = "";
  };
  const addPendingFolder = (): void => {
    const label = folder.value.trim();
    if (!label) return;
    const existing = availableFolders.find(
      (candidate) => formatFolderLabel(candidate) === label,
    );
    selectedFolder = existing ?? {
      id: null,
      path: [...(selectedFolder?.path ?? []), label],
    };
    folder.value = "";
    renderSelectedFolder();
  };
  renderSelectedTags();
  renderSelectedFolder();
  tags.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addPendingTag();
  });
  folder.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addPendingFolder();
  });

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
    addPendingTag();
    addPendingFolder();
    void Promise.resolve(
      options.onSave?.({
        description: description.value,
        folder: selectedFolder,
        tags: [...selectedTags],
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
      if (values.tags !== undefined) {
        selectedTags = [...values.tags];
        tags.value = "";
        renderSelectedTags();
      }
      if (values.folder !== undefined) {
        selectedFolder = values.folder;
        folder.value = "";
        renderSelectedFolder();
      }
      if (values.description !== undefined) description.value = values.description;
    },
    setChoices(choices) {
      const replaceOptions = <T>(
        target: HTMLDataListElement,
        values: readonly T[] | undefined,
        labelFor: (value: T) => string,
      ): void => {
        if (!values) return;
        target.replaceChildren(
          ...[...new Set(values.map(labelFor))].map((value) => {
            const option = document.createElement("option");
            option.value = value;
            return option;
          }),
        );
      };
      if (choices.tags) availableTags = [...choices.tags];
      if (choices.folders) availableFolders = [...choices.folders];
      replaceOptions(tagChoices, choices.tags, (choice) => choice.name);
      replaceOptions(folderChoices, choices.folders, formatFolderLabel);
    },
    setLabels(next) {
      title.textContent = next.title;
      closeButton.textContent = next.labels.close;
      descriptionLabel.textContent = next.labels.description;
      if (tagsFieldLabel) tagsFieldLabel.textContent = next.labels.tags;
      if (folderFieldLabel) folderFieldLabel.textContent = next.labels.folder;
      tagsHelp.textContent = next.labels.tagsHelp ?? "";
      tagsHelp.hidden = !next.labels.tagsHelp;
      saveButton.textContent = next.labels.save;
      if (status.dataset.state === "pending" && next.labels.pending) {
        status.textContent = next.labels.pending;
      }
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
