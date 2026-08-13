import type { BookmarkRecord, FolderRecord } from "../domain/types";
import { folderBreadcrumb, sortFolders } from "../domain/folder-tree";
import type {
  BookmarkDetailResult,
  FolderDeleteResult,
  FolderDetailResult,
  FolderListResult,
  SendMessage,
} from "./protocol";
import type { Translator } from "./i18n";
import { organizationUsageLabel } from "./organization-usage-label";
import { createIconButton } from "../ui/icons";

interface FolderUiOptions {
  document: Document;
  sendMessage: SendMessage;
  translate: Translator;
  onBookmarkUpdated: (bookmark: BookmarkRecord) => void;
  onFoldersChanged?: (
    folders: readonly FolderRecord[],
    usage: Readonly<Record<string, number>>,
  ) => void;
  onFolderSelected?: (folderPath: string) => void;
  onTrashChanged?: () => void;
}

interface FolderElements {
  assignment: HTMLSelectElement;
  breadcrumb: HTMLOListElement;
  createForm: HTMLFormElement;
  createName: HTMLInputElement;
  createParent: HTMLSelectElement;
  list: HTMLUListElement;
  managerStatus: HTMLElement | null;
  overviewList: HTMLUListElement | null;
  status: HTMLElement;
}

function requireElement<T extends HTMLElement>(document: Document, id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing folder element: #${id}`);
  return element as T;
}

function getElements(document: Document): FolderElements {
  return {
    assignment: requireElement(document, "folder-assignment"),
    breadcrumb: requireElement(document, "folder-breadcrumb-list"),
    createForm: requireElement(document, "create-folder-form"),
    createName: requireElement(document, "folder-name"),
    createParent: requireElement(document, "folder-parent"),
    list: requireElement(document, "folder-list"),
    managerStatus: document.getElementById("folder-manager-status"),
    overviewList: document.getElementById(
      "folder-overview-list",
    ) as HTMLUListElement | null,
    status: requireElement(document, "folder-status"),
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

export function createFolderUi(options: FolderUiOptions): {
  ready: Promise<void>;
  refresh: () => Promise<void>;
  setBookmark: (bookmark: BookmarkRecord | null) => void;
} {
  const {
    document,
    onBookmarkUpdated,
    onFoldersChanged,
    onFolderSelected,
    onTrashChanged,
    sendMessage,
    translate,
  } = options;
  const elements = getElements(document);
  let folders: FolderRecord[] = [];
  let usage: Record<string, number> = {};
  let bookmark: BookmarkRecord | null = null;
  let busy = false;
  let editingId: string | null = null;
  let deletingId: string | null = null;

  const setStatus = (key: string | null, state = "idle"): void => {
    const message = key === null ? "" : translate(key);
    elements.status.textContent = message;
    elements.status.dataset.state = state;
    if (elements.managerStatus) {
      elements.managerStatus.textContent = message;
      elements.managerStatus.dataset.state = state;
    }
  };

  const pathLabel = (folder: FolderRecord): string =>
    folderBreadcrumb(folder.id, folders)
      .map(({ name }) => name)
      .join(" / ");

  const renderSelects = (): void => {
    const assignmentValue = bookmark?.folderId ?? "";
    const parentValue = elements.createParent.value;
    elements.assignment.replaceChildren();
    elements.createParent.replaceChildren();
    appendOption(document, elements.assignment, "", translate("uncategorizedFolder"));
    appendOption(document, elements.createParent, "", translate("rootFolder"));
    for (const folder of folders) {
      const label = pathLabel(folder);
      appendOption(document, elements.assignment, folder.id, label);
      appendOption(document, elements.createParent, folder.id, label);
    }
    elements.assignment.value = folders.some(({ id }) => id === assignmentValue)
      ? assignmentValue
      : "";
    elements.createParent.value = folders.some(({ id }) => id === parentValue)
      ? parentValue
      : "";
    elements.assignment.disabled = bookmark === null || busy;
    elements.createName.disabled = busy;
    elements.createParent.disabled = busy;
    elements.createForm
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((button) => (button.disabled = busy));
  };

  const renderBreadcrumb = (): void => {
    elements.breadcrumb.replaceChildren();
    const path = folderBreadcrumb(bookmark?.folderId ?? null, folders);
    if (path.length === 0) {
      const item = document.createElement("li");
      item.textContent = translate("uncategorizedFolder");
      elements.breadcrumb.append(item);
      return;
    }
    for (const folder of path) {
      const item = document.createElement("li");
      item.textContent = folder.name;
      elements.breadcrumb.append(item);
    }
  };

  const createActionButton = (
    labelKey: string,
    action: string,
    folderId: string,
  ): HTMLButtonElement => {
    const button = createIconButton({
      document,
      icon: action === "delete" ? "trash" : "edit",
      label: translate(labelKey),
      className: "folder-action",
    });
    button.dataset.folderAction = action;
    button.dataset.folderId = folderId;
    button.disabled = busy;
    return button;
  };

  const renderFolderList = (): void => {
    elements.list.replaceChildren();
    for (const folder of folders) {
      const item = document.createElement("li");
      item.className = "folder-list-item";
      if (editingId === folder.id) {
        const form = document.createElement("form");
        const input = document.createElement("input");
        const save = document.createElement("button");
        const cancel = document.createElement("button");
        form.className = "folder-rename-form";
        form.dataset.folderRenameForm = folder.id;
        input.value = folder.name;
        input.maxLength = 100;
        input.required = true;
        input.dataset.folderRenameInput = folder.id;
        input.setAttribute(
          "aria-label",
          translate("renameFolderInputLabel", folder.name),
        );
        save.type = "submit";
        save.className = "button button-secondary compact-button";
        save.textContent = translate("saveFolderName");
        cancel.type = "button";
        cancel.className = "text-button";
        cancel.textContent = translate("cancelButton");
        cancel.addEventListener("click", () => {
          editingId = null;
          renderFolderList();
        });
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          void renameFolder(folder.id, input.value);
        });
        form.append(input, save, cancel);
        item.append(form);
      } else {
        const name = document.createElement("span");
        const actions = document.createElement("span");
        name.className = "folder-path-label";
        name.textContent = `${pathLabel(folder)} · ${usage[folder.id] ?? 0}`;
        actions.className = "folder-item-actions";
        const rename = createActionButton("renameFolder", "rename", folder.id);
        rename.addEventListener("click", () => {
          editingId = folder.id;
          deletingId = null;
          renderFolderList();
          Array.from(
            elements.list.querySelectorAll<HTMLInputElement>(
              "[data-folder-rename-input]",
            ),
          )
            .find((input) => input.dataset.folderRenameInput === folder.id)
            ?.focus();
        });
        const remove = createActionButton("deleteFolder", "delete", folder.id);
        remove.classList.add("danger");
        remove.addEventListener("click", () => {
          deletingId = folder.id;
          editingId = null;
          renderFolderList();
        });
        actions.append(rename, remove);
        item.append(name, actions);

        if (deletingId === folder.id) {
          const confirmation = document.createElement("div");
          const message = document.createElement("p");
          const confirm = document.createElement("button");
          const cancel = document.createElement("button");
          confirmation.className = "folder-delete-confirmation";
          message.textContent = translate("deleteFolderConfirmation", folder.name);
          confirm.type = "button";
          confirm.className = "button button-danger compact-button";
          confirm.textContent = translate("confirmDeleteFolder");
          confirm.dataset.folderDeleteConfirm = folder.id;
          confirm.addEventListener("click", () => void deleteFolder(folder.id));
          cancel.type = "button";
          cancel.className = "text-button";
          cancel.textContent = translate("cancelButton");
          cancel.addEventListener("click", () => {
            deletingId = null;
            renderFolderList();
          });
          confirmation.append(message, confirm, cancel);
          item.append(confirmation);
        }
      }
      elements.list.append(item);
    }
  };

  const renderOverview = (): void => {
    if (!elements.overviewList) return;
    elements.overviewList.replaceChildren();
    for (const folder of folders) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      const name = document.createElement("span");
      const count = document.createElement("strong");
      const label = pathLabel(folder);
      button.type = "button";
      button.className = "organization-item";
      button.setAttribute(
        "aria-label",
        organizationUsageLabel(
          translate,
          "folderUsageLabel",
          label,
          usage[folder.id] ?? 0,
        ),
      );
      name.textContent = label;
      count.textContent = String(usage[folder.id] ?? 0);
      button.append(name, count);
      button.addEventListener("click", () => onFolderSelected?.(label));
      item.append(button);
      elements.overviewList.append(item);
    }
  };

  const render = (): void => {
    renderSelects();
    renderBreadcrumb();
    renderFolderList();
    renderOverview();
  };

  async function renameFolder(id: string, name: string): Promise<void> {
    if (busy) return;
    busy = true;
    setStatus("folderSaving", "saving");
    render();
    try {
      const response = await sendMessage<FolderDetailResult>({
        type: "RENAME_FOLDER",
        payload: { id, name },
      });
      if (!response.ok || !response.data?.folder) throw new Error("rename failed");
      folders = sortFolders(
        folders.map((folder) =>
          folder.id === response.data.folder.id ? response.data.folder : folder,
        ),
      );
      onFoldersChanged?.(folders, usage);
      editingId = null;
      setStatus("folderSaved", "saved");
    } catch {
      setStatus("folderActionError", "error");
    } finally {
      busy = false;
      render();
    }
  }

  async function deleteFolder(id: string): Promise<void> {
    if (busy) return;
    busy = true;
    setStatus("folderDeleting", "saving");
    render();
    try {
      const response = await sendMessage<FolderDeleteResult>({
        type: "DELETE_FOLDER",
        payload: { id },
      });
      if (!response.ok || !response.data?.deletedFolderIds) {
        throw new Error("delete failed");
      }
      const deleted = new Set(response.data.deletedFolderIds);
      folders = folders.filter((folder) => !deleted.has(folder.id));
      for (const folderId of deleted) delete usage[folderId];
      onFoldersChanged?.(folders, usage);
      deletingId = null;
      setStatus("folderDeleted", "saved");
      onTrashChanged?.();
    } catch {
      setStatus("folderActionError", "error");
    } finally {
      busy = false;
      render();
    }
  }

  elements.assignment.addEventListener("change", () => {
    if (bookmark === null || busy) return;
    const previous = bookmark;
    const folderId = elements.assignment.value || null;
    busy = true;
    setStatus("folderSaving", "saving");
    render();
    void sendMessage<BookmarkDetailResult>({
      type: "ASSIGN_BOOKMARK_FOLDER",
      payload: { bookmarkId: bookmark.id, folderId },
    })
      .then((response) => {
        if (!response.ok || !response.data?.bookmark) {
          throw new Error("assignment failed");
        }
        bookmark = response.data.bookmark;
        onBookmarkUpdated(bookmark);
        void refreshFolders();
        setStatus("folderSaved", "saved");
      })
      .catch(() => {
        bookmark = previous;
        setStatus("folderActionError", "error");
      })
      .finally(() => {
        busy = false;
        render();
      });
  });

  elements.createForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (busy || !elements.createForm.reportValidity()) return;
    busy = true;
    setStatus("folderSaving", "saving");
    render();
    void sendMessage<FolderDetailResult>({
      type: "CREATE_FOLDER",
      payload: {
        name: elements.createName.value,
        parentId: elements.createParent.value || null,
      },
    })
      .then((response) => {
        if (!response.ok || !response.data?.folder) throw new Error("create failed");
        folders = sortFolders([...folders, response.data.folder]);
        usage[response.data.folder.id] = 0;
        onFoldersChanged?.(folders, usage);
        elements.createName.value = "";
        setStatus("folderCreated", "saved");
      })
      .catch(() => setStatus("folderActionError", "error"))
      .finally(() => {
        busy = false;
        render();
      });
  });

  async function refreshFolders(): Promise<void> {
    return sendMessage<FolderListResult>({ type: "LIST_FOLDERS" })
      .then((response) => {
        if (!response.ok || !Array.isArray(response.data?.folders)) {
          throw new Error("folder list failed");
        }
        folders = sortFolders(response.data.folders);
        usage = response.data.usage ?? {};
        onFoldersChanged?.(folders, usage);
        setStatus(null);
      })
      .catch(() => setStatus("folderLoadError", "error"))
      .finally(render);
  }

  const ready = refreshFolders();

  render();
  return {
    ready,
    refresh: refreshFolders,
    setBookmark: (nextBookmark) => {
      bookmark = nextBookmark;
      render();
    },
  };
}
