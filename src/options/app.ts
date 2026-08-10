import type { ExtensionSettings, SettingsPatch } from "../settings/settings-repository";
import {
  DEFAULT_DATE_TIME_PREFERENCES,
  type DateTimePreferences,
} from "../settings/date-time-preferences";
import {
  DEFAULT_QUICK_STOP_THRESHOLD,
  MAX_QUICK_STOP_THRESHOLD,
  MIN_QUICK_STOP_THRESHOLD,
} from "../domain/quick-update";
import type { SendMessage, SettingsResult } from "../shared/protocol";
import type { Translator } from "../popup/i18n";

interface OptionsAppOptions {
  document: Document;
  sendMessage: SendMessage;
  translate: Translator;
  loadGithubStars?: () => Promise<number | null>;
  loadDateTimePreferences?: () => Promise<DateTimePreferences>;
  saveDateTimePreferences?: (preferences: DateTimePreferences) => Promise<void>;
}

function input(document: Document, id: string): HTMLInputElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`Missing settings input: #${id}`);
  }
  return element;
}

function select(document: Document, id: string): HTMLSelectElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error(`Missing settings select: #${id}`);
  }
  return element;
}

export function createOptionsApp(options: OptionsAppOptions): {
  ready: Promise<void>;
  githubReady: Promise<void>;
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
    dateFormat: select(document, "appearance-date-format"),
    timeFormat: select(document, "appearance-time-format"),
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
    exportFirstSaved: input(document, "export-first-saved"),
    exportLastSeen: input(document, "export-last-seen"),
    liveFilter: input(document, "search-live-filter"),
    quickStopThreshold: input(document, "data-quick-stop-threshold"),
    keepArchived: input(document, "data-keep-archived"),
  };
  let settings: ExtensionSettings | null = null;
  let dateTimePreferences = DEFAULT_DATE_TIME_PREFERENCES;
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
    controls.exportFirstSaved.checked = next.export.includeFirstSavedAt;
    controls.exportLastSeen.checked = next.export.includeLastSeenAt;
    controls.liveFilter.checked = next.search.filterAsYouType;
    controls.quickStopThreshold.value = String(next.data.quickStopThreshold);
    controls.keepArchived.checked = next.data.keepArchived;
  };

  const renderDateTimePreferences = (next: DateTimePreferences): void => {
    dateTimePreferences = next;
    controls.dateFormat.value = next.dateFormat;
    controls.timeFormat.value = next.timeFormat;
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
      controls.exportFirstSaved,
      () => ({
        export: { includeFirstSavedAt: controls.exportFirstSaved.checked },
      }),
    ],
    [
      controls.exportLastSeen,
      () => ({ export: { includeLastSeenAt: controls.exportLastSeen.checked } }),
    ],
    [
      controls.liveFilter,
      () => ({ search: { filterAsYouType: controls.liveFilter.checked } }),
    ],
    [
      controls.keepArchived,
      () => ({ data: { keepArchived: controls.keepArchived.checked } }),
    ],
    [
      controls.quickStopThreshold,
      () => {
        const requested = Number(controls.quickStopThreshold.value);
        const quickStopThreshold = Number.isFinite(requested)
          ? Math.min(
              MAX_QUICK_STOP_THRESHOLD,
              Math.max(MIN_QUICK_STOP_THRESHOLD, Math.round(requested)),
            )
          : DEFAULT_QUICK_STOP_THRESHOLD;
        controls.quickStopThreshold.value = String(quickStopThreshold);
        return { data: { quickStopThreshold } };
      },
    ],
  ];
  const exportControls = [
    controls.exportLink,
    controls.exportText,
    controls.exportAuthor,
    controls.exportDate,
    controls.exportImages,
    controls.exportVideos,
    controls.exportNote,
    controls.exportTags,
    controls.exportFolder,
    controls.exportFirstSaved,
    controls.exportLastSeen,
  ];
  const listeners = bindings.map(([control, patch]) => {
    const listener = (): void => {
      if (
        exportControls.includes(control) &&
        !exportControls.some(({ checked }) => checked)
      ) {
        control.checked = true;
        status.textContent = translate("settingsExportFieldRequired");
        return;
      }
      save(patch());
    };
    control.addEventListener("change", listener);
    return [control, listener] as const;
  });

  const saveDateTime = (next: DateTimePreferences): void => {
    if (destroyed) return;
    renderDateTimePreferences(next);
    status.textContent = translate("settingsSaving");
    saveQueue = saveQueue.then(async () => {
      if (destroyed) return;
      try {
        await options.saveDateTimePreferences?.(next);
        if (!destroyed) status.textContent = translate("settingsSaved");
      } catch {
        if (!destroyed) status.textContent = translate("settingsSaveError");
      }
    });
  };
  const dateFormatListener = (): void => {
    saveDateTime({
      ...dateTimePreferences,
      dateFormat: controls.dateFormat.value as DateTimePreferences["dateFormat"],
    });
  };
  const timeFormatListener = (): void => {
    saveDateTime({
      ...dateTimePreferences,
      timeFormat: controls.timeFormat.value as DateTimePreferences["timeFormat"],
    });
  };
  controls.dateFormat.addEventListener("change", dateFormatListener);
  controls.timeFormat.addEventListener("change", timeFormatListener);

  const ready = Promise.all([
    sendMessage<SettingsResult>({ type: "GET_SETTINGS" }),
    options.loadDateTimePreferences?.() ??
      Promise.resolve(DEFAULT_DATE_TIME_PREFERENCES),
  ]).then(
    ([response, preferences]) => {
      if (destroyed) return;
      if (!response.ok) {
        document.documentElement.dataset.settingsState = "error";
        status.textContent = translate("settingsLoadError");
        return;
      }
      render(response.data.settings);
      renderDateTimePreferences(preferences);
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

  const githubStarCount = document.getElementById("github-star-count");
  if (!githubStarCount) throw new Error("Missing GitHub star count");
  const githubReady = (options.loadGithubStars?.() ?? Promise.resolve(null)).then(
    (stars) => {
      if (destroyed || stars === null) return;
      const locale = document.documentElement.lang || "en";
      const formattedStars = new Intl.NumberFormat(locale).format(stars);
      githubStarCount.textContent = translate("githubStarCount", formattedStars);
      githubStarCount.hidden = false;
    },
    () => {
      // The project link remains useful; a network failure only hides the number.
    },
  );

  return {
    ready,
    githubReady,
    destroy() {
      destroyed = true;
      for (const [control, listener] of listeners) {
        control.removeEventListener("change", listener);
      }
      controls.dateFormat.removeEventListener("change", dateFormatListener);
      controls.timeFormat.removeEventListener("change", timeFormatListener);
    },
  };
}
