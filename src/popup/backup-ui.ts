import { MAX_BACKUP_BYTES } from "../domain/backup";
import type {
  JsonBackupExportResult,
  JsonBackupRestoreResult,
  RuntimeError,
  UiRequest,
} from "./protocol";
import type { Translator } from "./i18n";

interface BackupUiOptions {
  document: Document;
  translate: Translator;
  perform: (
    request: UiRequest,
    afterSuccess?: (data: unknown) => void | Promise<void>,
    afterError?: (error: RuntimeError) => void | Promise<void>,
  ) => Promise<void>;
  createDownload: (result: JsonBackupExportResult) => void;
  readFile: (file: File) => Promise<string>;
  confirmReplace: (message: string) => boolean;
  onDataRestored: () => void | Promise<void>;
  reload: () => void;
}

interface BackupElements {
  file: HTMLInputElement;
  mode: HTMLSelectElement;
  status: HTMLElement;
  exportButton: HTMLButtonElement;
  restoreButton: HTMLButtonElement;
}

function requireElement<T extends HTMLElement>(document: Document, id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing popup element: #${id}`);
  return element as T;
}

function getElements(document: Document): BackupElements {
  return {
    file: requireElement(document, "backup-file-input"),
    mode: requireElement(document, "backup-restore-mode"),
    status: requireElement(document, "backup-status"),
    exportButton: requireElement(document, "export-backup-button"),
    restoreButton: requireElement(document, "restore-backup-button"),
  };
}

export function createBackupUi(options: BackupUiOptions): {
  setDisabled: (appBusy: boolean, captureRunning: boolean) => void;
} {
  const {
    document,
    translate,
    perform,
    createDownload,
    readFile,
    confirmReplace,
    onDataRestored,
    reload,
  } = options;
  const elements = getElements(document);
  let selectedFile: File | null = null;
  let reading = false;
  let appBusy = false;
  let captureRunning = false;

  const renderDisabled = (): void => {
    elements.exportButton.disabled = appBusy;
    elements.file.disabled = appBusy || reading;
    elements.mode.disabled = appBusy || reading;
    elements.restoreButton.disabled =
      appBusy || reading || captureRunning || selectedFile === null;
  };

  elements.exportButton.addEventListener("click", () => {
    void perform({ type: "EXPORT_BACKUP" }, (data) =>
      createDownload(data as JsonBackupExportResult),
    );
  });

  elements.file.addEventListener("change", () => {
    const file = elements.file.files?.[0] ?? null;
    selectedFile = file !== null && file.size <= MAX_BACKUP_BYTES ? file : null;
    elements.status.textContent =
      file === null
        ? ""
        : file.size > MAX_BACKUP_BYTES
          ? translate("backupTooLarge")
          : translate("backupFileReady");
    renderDisabled();
  });

  elements.restoreButton.addEventListener("click", () => {
    const file = selectedFile;
    if (file === null || reading) return;
    const mode = elements.mode.value === "replace" ? "replace" : "merge";
    if (mode === "replace" && !confirmReplace(translate("confirmReplaceBackup"))) {
      return;
    }

    reading = true;
    elements.status.textContent = translate("backupReading");
    renderDisabled();
    void readFile(file)
      .then((content) => {
        if (new TextEncoder().encode(content).byteLength > MAX_BACKUP_BYTES) {
          elements.status.textContent = translate("backupTooLarge");
          return;
        }
        const request: UiRequest =
          mode === "replace"
            ? {
                type: "RESTORE_BACKUP",
                payload: { content, mode, confirmed: true },
              }
            : { type: "RESTORE_BACKUP", payload: { content, mode } };
        return perform(
          request,
          async (data) => {
            const result = data as JsonBackupRestoreResult;
            elements.status.textContent = translate(
              "backupRestoreComplete",
              String(result.bookmarks),
            );
            await onDataRestored();
            if (result.reloadRequired) reload();
          },
          async (error) => {
            if (
              error.recovery?.dataRestored === true &&
              error.recovery.reloadRequired
            ) {
              elements.status.textContent = translate("backupRestorePartial");
              await onDataRestored();
              reload();
            }
          },
        );
      })
      .catch(() => {
        elements.status.textContent = translate("backupReadError");
      })
      .finally(() => {
        reading = false;
        renderDisabled();
      });
  });

  renderDisabled();
  return {
    setDisabled: (nextAppBusy, nextCaptureRunning) => {
      appBusy = nextAppBusy;
      captureRunning = nextCaptureRunning;
      renderDisabled();
    },
  };
}
