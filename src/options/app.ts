import type { ExtensionSettings, SettingsPatch } from "../settings/settings-repository";
import type { SendMessage, SettingsResult } from "../shared/protocol";
import type { Translator } from "../popup/i18n";

interface OptionsAppOptions {
  document: Document;
  sendMessage: SendMessage;
  translate: Translator;
}

function input(document: Document, id: string): HTMLInputElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`Missing settings input: #${id}`);
  }
  return element;
}

export function createOptionsApp(options: OptionsAppOptions): {
  ready: Promise<void>;
  destroy(): void;
} {
  const { document, sendMessage, translate } = options;
  const status = document.getElementById("settings-status");
  if (!status) throw new Error("Missing settings status");
  document.documentElement.dataset.settingsState = "loading";

  const controls = {
    largeText: input(document, "appearance-large-text"),
    highContrast: input(document, "appearance-high-contrast"),
    reduceMotion: input(document, "appearance-reduce-motion"),
    modal: input(document, "surface-modal"),
    sidePanel: input(document, "surface-side-panel"),
    prompt: input(document, "behavior-prompt"),
    summary: input(document, "metadata-summary"),
    breadcrumb: input(document, "metadata-breadcrumb"),
    tags: input(document, "metadata-tags"),
    note: input(document, "metadata-note"),
    category: input(document, "metadata-category"),
    exportLink: input(document, "export-link"),
    exportText: input(document, "export-text"),
    exportAuthor: input(document, "export-author"),
    exportDate: input(document, "export-date"),
    exportImages: input(document, "export-images"),
    exportVideos: input(document, "export-videos"),
    exportNote: input(document, "export-note"),
    exportTags: input(document, "export-tags"),
    exportFolder: input(document, "export-folder"),
    liveFilter: input(document, "search-live-filter"),
    keepArchived: input(document, "data-keep-archived"),
  };
  let settings: ExtensionSettings | null = null;
  let saveQueue = Promise.resolve();
  let destroyed = false;

  const render = (next: ExtensionSettings): void => {
    settings = next;
    controls.largeText.checked = next.appearance.largeText;
    controls.highContrast.checked = next.appearance.highContrast;
    controls.reduceMotion.checked = next.appearance.reduceMotion;
    controls.modal.checked = next.behavior.surface === "modal";
    controls.sidePanel.checked = next.behavior.surface === "sidePanel";
    controls.prompt.checked = next.behavior.promptAfterBookmark;
    controls.summary.checked = next.behavior.metadata.summary;
    controls.breadcrumb.checked = next.behavior.metadata.breadcrumb;
    controls.tags.checked = next.behavior.metadata.tags;
    controls.note.checked = next.behavior.metadata.note;
    controls.category.checked = next.behavior.metadata.categoryIndicator;
    controls.exportLink.checked = next.export.includeLink;
    controls.exportText.checked = next.export.includeText;
    controls.exportAuthor.checked = next.export.includeAuthor;
    controls.exportDate.checked = next.export.includeDate;
    controls.exportImages.checked = next.export.includeImages;
    controls.exportVideos.checked = next.export.includeVideos;
    controls.exportNote.checked = next.export.includeNote;
    controls.exportTags.checked = next.export.includeTags;
    controls.exportFolder.checked = next.export.includeFolder;
    controls.liveFilter.checked = next.search.filterAsYouType;
    controls.keepArchived.checked = next.data.keepArchived;
  };

  const save = (patch: SettingsPatch): void => {
    if (!settings || destroyed) return;
    status.textContent = translate("settingsSaving");
    saveQueue = saveQueue.then(async () => {
      if (destroyed) return;
      status.textContent = translate("settingsSaving");
      try {
        const response = await sendMessage<SettingsResult>({
          type: "SAVE_SETTINGS",
          payload: { settings: patch },
        });
        if (destroyed) return;
        if (!response.ok) {
          status.textContent = translate("settingsSaveError");
          return;
        }
        render(response.data.settings);
        status.textContent = translate("settingsSaved");
      } catch {
        if (destroyed) return;
        status.textContent = translate("settingsSaveError");
      }
    });
  };

  const bindings: Array<[HTMLInputElement, () => SettingsPatch]> = [
    [
      controls.largeText,
      () => ({ appearance: { largeText: controls.largeText.checked } }),
    ],
    [
      controls.highContrast,
      () => ({ appearance: { highContrast: controls.highContrast.checked } }),
    ],
    [
      controls.reduceMotion,
      () => ({ appearance: { reduceMotion: controls.reduceMotion.checked } }),
    ],
    [controls.modal, () => ({ behavior: { surface: "modal" } })],
    [controls.sidePanel, () => ({ behavior: { surface: "sidePanel" } })],
    [
      controls.prompt,
      () => ({ behavior: { promptAfterBookmark: controls.prompt.checked } }),
    ],
    [
      controls.summary,
      () => ({ behavior: { metadata: { summary: controls.summary.checked } } }),
    ],
    [
      controls.breadcrumb,
      () => ({ behavior: { metadata: { breadcrumb: controls.breadcrumb.checked } } }),
    ],
    [
      controls.tags,
      () => ({ behavior: { metadata: { tags: controls.tags.checked } } }),
    ],
    [
      controls.note,
      () => ({ behavior: { metadata: { note: controls.note.checked } } }),
    ],
    [
      controls.category,
      () => ({
        behavior: { metadata: { categoryIndicator: controls.category.checked } },
      }),
    ],
    [
      controls.exportLink,
      () => ({ export: { includeLink: controls.exportLink.checked } }),
    ],
    [
      controls.exportText,
      () => ({ export: { includeText: controls.exportText.checked } }),
    ],
    [
      controls.exportAuthor,
      () => ({ export: { includeAuthor: controls.exportAuthor.checked } }),
    ],
    [
      controls.exportDate,
      () => ({ export: { includeDate: controls.exportDate.checked } }),
    ],
    [
      controls.exportImages,
      () => ({ export: { includeImages: controls.exportImages.checked } }),
    ],
    [
      controls.exportVideos,
      () => ({ export: { includeVideos: controls.exportVideos.checked } }),
    ],
    [
      controls.exportNote,
      () => ({ export: { includeNote: controls.exportNote.checked } }),
    ],
    [
      controls.exportTags,
      () => ({ export: { includeTags: controls.exportTags.checked } }),
    ],
    [
      controls.exportFolder,
      () => ({ export: { includeFolder: controls.exportFolder.checked } }),
    ],
    [
      controls.liveFilter,
      () => ({ search: { filterAsYouType: controls.liveFilter.checked } }),
    ],
    [
      controls.keepArchived,
      () => ({ data: { keepArchived: controls.keepArchived.checked } }),
    ],
  ];
  const listeners = bindings.map(([control, patch]) => {
    const listener = (): void => save(patch());
    control.addEventListener("change", listener);
    return [control, listener] as const;
  });

  const ready = sendMessage<SettingsResult>({ type: "GET_SETTINGS" }).then(
    (response) => {
      if (destroyed) return;
      if (!response.ok) {
        document.documentElement.dataset.settingsState = "error";
        status.textContent = translate("settingsLoadError");
        return;
      }
      render(response.data.settings);
      document.documentElement.dataset.settingsState = "ready";
      status.textContent = "";
    },
    () => {
      if (!destroyed) {
        document.documentElement.dataset.settingsState = "error";
        status.textContent = translate("settingsLoadError");
      }
    },
  );

  return {
    ready,
    destroy() {
      destroyed = true;
      for (const [control, listener] of listeners) {
        control.removeEventListener("change", listener);
      }
    },
  };
}
