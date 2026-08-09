import type { ExtensionSettings } from "../settings/settings-repository";

interface SettingsUiControllerOptions {
  document: Document;
  load(): Promise<ExtensionSettings | null>;
}

export function applyLibraryUiSettings(
  document: Document,
  settings: ExtensionSettings,
): void {
  const root = document.documentElement;
  root.dataset.largeText = String(settings.appearance.largeText);
  root.dataset.highContrast = String(settings.appearance.highContrast);
  root.dataset.reduceMotion = String(settings.appearance.reduceMotion);
  root.dataset.metadataSummary = String(settings.behavior.metadata.summary);
  root.dataset.metadataBreadcrumb = String(settings.behavior.metadata.breadcrumb);
  root.dataset.metadataTags = String(settings.behavior.metadata.tags);
  root.dataset.metadataNote = String(settings.behavior.metadata.note);
  root.dataset.metadataCategoryIndicator = String(
    settings.behavior.metadata.categoryIndicator,
  );
}

export function createSettingsUiController(options: SettingsUiControllerOptions): {
  refresh(): Promise<void>;
  destroy(): void;
} {
  let revision = 0;
  let destroyed = false;

  return {
    async refresh() {
      const requestRevision = ++revision;
      try {
        const settings = await options.load();
        if (destroyed || requestRevision !== revision || settings === null) return;
        applyLibraryUiSettings(options.document, settings);
      } catch {
        // Retain the last successfully applied settings if the worker restarts.
      }
    },
    destroy() {
      destroyed = true;
      revision += 1;
    },
  };
}
