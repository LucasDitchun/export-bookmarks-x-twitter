import { folderBreadcrumb, sortFolders } from "../domain/folder-tree";
import type { BookmarkTag, FolderRecord, SupportedLocale } from "../domain/types";
import type { ExportResult, RuntimeError, UiRequest } from "../shared/protocol";
import type { Translator } from "./i18n";

type Perform = (
  request: UiRequest,
  afterSuccess?: (data: unknown) => void | Promise<void>,
  afterError?: (error: RuntimeError) => void | Promise<void>,
) => Promise<void>;

interface ExportUiOptions {
  document: Document;
  locale: SupportedLocale;
  translate: Translator;
  perform: Perform;
  createDownload: (result: ExportResult) => void;
}

interface ExportElements {
  folder: HTMLSelectElement;
  tags: HTMLSelectElement;
  includeArchived: HTMLInputElement;
  primary: HTMLButtonElement;
  menuToggle: HTMLButtonElement;
  menu: HTMLElement;
  status: HTMLElement;
}

function required<T extends HTMLElement>(document: Document, id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing export element: #${id}`);
  return element as T;
}

function getElements(document: Document): ExportElements {
  return {
    folder: required(document, "export-folder-filter"),
    tags: required(document, "export-tag-filter"),
    includeArchived: required(document, "export-include-archived"),
    primary: required(document, "export-primary-button"),
    menuToggle: required(document, "export-menu-button"),
    menu: required(document, "export-format-menu"),
    status: required(document, "export-status"),
  };
}

function appendOption(
  document: Document,
  select: HTMLSelectElement,
  value: string,
  label: string,
): void {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.append(option);
}

export function createExportUi(options: ExportUiOptions): {
  setDisabled(disabled: boolean): void;
  setFolders(folders: readonly FolderRecord[]): void;
  setTags(tags: readonly BookmarkTag[]): void;
  destroy(): void;
} {
  const { document, locale, translate, perform, createDownload } = options;
  const elements = getElements(document);
  const menuItems = Array.from(
    elements.menu.querySelectorAll<HTMLButtonElement>("[data-export-format]"),
  );
  let currentFolders: FolderRecord[] = [];
  let destroyed = false;

  const setStatus = (key: string | null): void => {
    elements.status.textContent = key === null ? "" : translate(key);
  };

  const closeMenu = (restoreFocus = false): void => {
    elements.menu.hidden = true;
    elements.menuToggle.setAttribute("aria-expanded", "false");
    if (restoreFocus) elements.menuToggle.focus();
  };

  const openMenu = (focusIndex?: number): void => {
    if (elements.menuToggle.disabled) return;
    elements.menu.hidden = false;
    elements.menuToggle.setAttribute("aria-expanded", "true");
    if (focusIndex !== undefined) menuItems[focusIndex]?.focus();
  };

  const selectedTagIds = (): string[] =>
    Array.from(elements.tags.selectedOptions, ({ value }) => value);

  const startExport = (format: "txt" | "md"): void => {
    if (destroyed || elements.primary.disabled) return;
    closeMenu();
    setStatus("exportPreparing");
    void perform(
      {
        type: "EXPORT_BOOKMARKS",
        payload: {
          format,
          locale,
          folderId: elements.folder.value || null,
          tagIds: selectedTagIds(),
          includeArchived: elements.includeArchived.checked,
        },
      },
      (data) => {
        createDownload(data as ExportResult);
        setStatus("exportDownloaded");
      },
      (error) => {
        setStatus(
          error.code === "export_fields_required"
            ? "exportFieldRequired"
            : "exportFailed",
        );
      },
    ).catch(() => setStatus("exportFailed"));
  };

  const onPrimaryClick = (): void => startExport("txt");
  const onToggleClick = (): void => {
    if (elements.menu.hidden) openMenu();
    else closeMenu();
  };
  const onToggleKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    openMenu(event.key === "ArrowDown" ? 0 : menuItems.length - 1);
  };
  const onMenuKeydown = (event: KeyboardEvent): void => {
    const index = menuItems.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown")
      nextIndex = (Math.max(index, 0) + 1) % menuItems.length;
    if (event.key === "ArrowUp") {
      nextIndex = (index <= 0 ? menuItems.length : index) - 1;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = menuItems.length - 1;
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    menuItems[nextIndex]?.focus();
  };
  const onDocumentClick = (event: MouseEvent): void => {
    if (
      !elements.menu.hidden &&
      event.target instanceof Node &&
      !elements.menu.contains(event.target) &&
      !elements.menuToggle.contains(event.target)
    ) {
      closeMenu();
    }
  };

  elements.primary.addEventListener("click", onPrimaryClick);
  elements.menuToggle.addEventListener("click", onToggleClick);
  elements.menuToggle.addEventListener("keydown", onToggleKeydown);
  elements.menu.addEventListener("keydown", onMenuKeydown);
  document.addEventListener("click", onDocumentClick);
  for (const item of menuItems) {
    item.addEventListener("click", () => {
      const format = item.dataset.exportFormat;
      if (format === "txt" || format === "md") startExport(format);
    });
  }

  return {
    setDisabled(disabled) {
      elements.primary.disabled = disabled;
      elements.menuToggle.disabled = disabled;
      elements.folder.disabled = disabled;
      elements.tags.disabled = disabled;
      elements.includeArchived.disabled = disabled;
      if (disabled) closeMenu();
    },
    setFolders(folders) {
      const selected = elements.folder.value;
      currentFolders = sortFolders([...folders]);
      elements.folder.replaceChildren();
      appendOption(document, elements.folder, "", translate("exportAllFolders"));
      for (const folder of currentFolders) {
        const label = folderBreadcrumb(folder.id, currentFolders)
          .map(({ name }) => name)
          .join(" / ");
        appendOption(document, elements.folder, folder.id, label);
      }
      elements.folder.value = currentFolders.some(({ id }) => id === selected)
        ? selected
        : "";
    },
    setTags(tags) {
      const selected = new Set(selectedTagIds());
      elements.tags.replaceChildren();
      for (const tag of [...tags].sort((left, right) =>
        left.normalizedName.localeCompare(right.normalizedName, "und"),
      )) {
        appendOption(document, elements.tags, tag.id, tag.name);
        elements.tags.options.item(elements.tags.options.length - 1)!.selected =
          selected.has(tag.id);
      }
    },
    destroy() {
      destroyed = true;
      elements.primary.removeEventListener("click", onPrimaryClick);
      elements.menuToggle.removeEventListener("click", onToggleClick);
      elements.menuToggle.removeEventListener("keydown", onToggleKeydown);
      elements.menu.removeEventListener("keydown", onMenuKeydown);
      document.removeEventListener("click", onDocumentClick);
    },
  };
}
