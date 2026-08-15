import type { Translator } from "../popup/i18n";
import { SemanticOperationCancelledError } from "../semantic/semantic-search-client";
import type { SemanticProgress } from "../semantic/semantic-worker-runtime";
import {
  DEFAULT_SEMANTIC_STATE,
  type SemanticSearchState,
} from "../semantic/semantic-state-repository";
import type { SemanticModelAccess } from "./semantic-model-access";

interface SemanticOptionsClient {
  getState(): Promise<SemanticSearchState>;
  installWithConsent(): Promise<SemanticSearchState>;
  reindex(): Promise<SemanticSearchState>;
  cancel(): Promise<void>;
  remove(): Promise<void>;
  setEnabled(enabled: boolean): Promise<SemanticSearchState>;
  subscribe(listener: (progress: SemanticProgress) => void): () => void;
}

interface StorageEstimate {
  usage?: number;
  quota?: number;
}

interface SemanticOptionsUiOptions {
  document: Document;
  client: SemanticOptionsClient;
  modelAccess: SemanticModelAccess;
  translate: Translator;
  estimateStorage?: () => Promise<StorageEstimate>;
}

function element<T extends HTMLElement>(document: Document, id: string): T {
  const value = document.getElementById(id);
  if (value === null) throw new Error(`Missing semantic options element: #${id}`);
  return value as T;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return `${Math.round(value)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = value / 1024;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(amount)} ${units[index]}`;
}

export function createSemanticOptionsUi(options: SemanticOptionsUiOptions): {
  ready: Promise<void>;
  destroy(): void;
} {
  const { document, client, modelAccess, translate } = options;
  const enabled = element<HTMLInputElement>(document, "semantic-enabled");
  const install = element<HTMLButtonElement>(document, "semantic-install");
  const cancel = element<HTMLButtonElement>(document, "semantic-cancel");
  const reindex = element<HTMLButtonElement>(document, "semantic-reindex");
  const remove = element<HTMLButtonElement>(document, "semantic-remove");
  const progress = element<HTMLProgressElement>(document, "semantic-progress");
  const progressCopy = element(document, "semantic-progress-copy");
  const status = element(document, "semantic-status");
  const storage = element(document, "semantic-storage");
  let destroyed = false;
  let busy = false;
  let hasModelAccess = false;
  let renderedState: SemanticSearchState = structuredClone(DEFAULT_SEMANTIC_STATE);

  const render = (state: SemanticSearchState): void => {
    if (destroyed) return;
    renderedState = state;
    const active =
      state.modelStatus === "downloading" || state.modelStatus === "indexing";
    const installed = state.modelStatus === "ready";
    enabled.checked = state.enabled;
    enabled.disabled = !installed || busy;
    install.hidden = installed || active;
    install.disabled = busy;
    cancel.hidden = !active && !busy;
    cancel.disabled = false;
    reindex.hidden = !installed;
    reindex.disabled = busy;
    remove.hidden = state.consentGrantedAt === null;
    remove.disabled = busy;
    if (state.modelStatus === "ready") {
      status.textContent = translate("semanticReady", [
        state.backend === "webgpu" ? "WebGPU" : "WASM",
        String(state.indexedBookmarks),
      ]);
    } else if (state.modelStatus === "downloading") {
      status.textContent = translate("semanticDownloading");
    } else if (state.modelStatus === "indexing") {
      status.textContent = translate("semanticIndexing");
    } else if (state.modelStatus === "error") {
      status.textContent = translate("semanticError");
    } else {
      status.textContent = translate("semanticNotInstalled");
    }
  };

  const unsubscribe = client.subscribe((value) => {
    if (destroyed) return;
    progress.hidden = false;
    const percentage =
      value.total > 0 ? Math.min(100, (value.completed / value.total) * 100) : 0;
    progress.value = percentage;
    progressCopy.textContent =
      value.phase === "indexing"
        ? translate("semanticIndexProgress", [
            String(value.completed),
            String(value.total),
          ])
        : translate("semanticDownloadProgress", String(Math.round(percentage)));
  });

  const run = async (
    operation: () => Promise<SemanticSearchState>,
    failureKey: string,
  ): Promise<void> => {
    if (busy || destroyed) return;
    busy = true;
    let failureMessage: string | null = null;
    let cancelled = false;
    try {
      render(await client.getState());
      render(await operation());
    } catch (error) {
      cancelled = error instanceof SemanticOperationCancelledError;
      if (!cancelled) {
        failureMessage = translate(failureKey);
        try {
          renderedState = await client.getState();
        } catch {
          // Preserve the last rendered state if local storage is unavailable.
        }
      }
    } finally {
      busy = false;
      if (!destroyed && !cancelled) {
        render(renderedState);
        if (failureMessage !== null) status.textContent = failureMessage;
      }
    }
  };

  const installListener = (): void => {
    if (busy || destroyed) return;
    const accessRequest = modelAccess.request();
    void run(async () => {
      if (!(await accessRequest)) return client.getState();
      hasModelAccess = true;
      return client.installWithConsent();
    }, "semanticInstallError");
  };
  const reindexListener = () =>
    void run(() => client.reindex(), "semanticReindexError");
  const cancelListener = (): void => {
    void client.cancel().then(async () => render(await client.getState()));
  };
  const removeListener = (): void => {
    if (busy || destroyed) return;
    busy = true;
    void client
      .remove()
      .then(async () => {
        if (hasModelAccess && (await modelAccess.remove())) {
          hasModelAccess = false;
        }
        progress.hidden = true;
        progressCopy.textContent = "";
        render(structuredClone(DEFAULT_SEMANTIC_STATE));
      })
      .catch(() => {
        status.textContent = translate("semanticRemoveError");
      })
      .finally(() => {
        busy = false;
      });
  };
  const enabledListener = (): void => {
    void client.setEnabled(enabled.checked).then(render, () => {
      status.textContent = translate("semanticToggleError");
    });
  };
  install.addEventListener("click", installListener);
  reindex.addEventListener("click", reindexListener);
  cancel.addEventListener("click", cancelListener);
  remove.addEventListener("click", removeListener);
  enabled.addEventListener("change", enabledListener);

  const ready = Promise.all([
    client.getState(),
    modelAccess.contains(),
    (options.estimateStorage ?? (() => navigator.storage.estimate()))().catch(
      () => ({}),
    ),
  ]).then(([state, containsModelAccess, estimate]) => {
    if (destroyed) return;
    hasModelAccess = containsModelAccess;
    render(state);
    const storageEstimate = estimate as StorageEstimate;
    storage.textContent = translate("semanticStorageEstimate", [
      formatBytes(storageEstimate.usage ?? 0),
      formatBytes(storageEstimate.quota ?? 0),
    ]);
  });

  return {
    ready,
    destroy() {
      destroyed = true;
      unsubscribe();
      install.removeEventListener("click", installListener);
      reindex.removeEventListener("click", reindexListener);
      cancel.removeEventListener("click", cancelListener);
      remove.removeEventListener("click", removeListener);
      enabled.removeEventListener("change", enabledListener);
    },
  };
}
