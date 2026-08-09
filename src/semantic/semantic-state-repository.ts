export const SEMANTIC_STATE_KEY = "semanticSearchState";
export const SEMANTIC_STATE_SCHEMA_VERSION = 1 as const;

export type SemanticModelStatus =
  "notInstalled" | "downloading" | "indexing" | "ready" | "error";

export interface SemanticSearchState {
  enabled: boolean;
  consentGrantedAt: string | null;
  modelStatus: SemanticModelStatus;
  backend: "webgpu" | "wasm" | null;
  indexedBookmarks: number;
  updatedAt: string | null;
  errorCode: string | null;
}

export const DEFAULT_SEMANTIC_STATE: Readonly<SemanticSearchState> = Object.freeze({
  enabled: false,
  consentGrantedAt: null,
  modelStatus: "notInstalled",
  backend: null,
  indexedBookmarks: 0,
  updatedAt: null,
  errorCode: null,
});

interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function parseState(value: unknown): SemanticSearchState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (
    envelope.schemaVersion !== SEMANTIC_STATE_SCHEMA_VERSION ||
    typeof envelope.state !== "object" ||
    envelope.state === null ||
    Array.isArray(envelope.state)
  ) {
    return null;
  }
  const state = envelope.state as Record<string, unknown>;
  const statuses: SemanticModelStatus[] = [
    "notInstalled",
    "downloading",
    "indexing",
    "ready",
    "error",
  ];
  const expected = [
    "enabled",
    "consentGrantedAt",
    "modelStatus",
    "backend",
    "indexedBookmarks",
    "updatedAt",
    "errorCode",
  ];
  if (
    Object.keys(state).length !== expected.length ||
    !expected.every((key) => Object.hasOwn(state, key)) ||
    typeof state.enabled !== "boolean" ||
    (state.consentGrantedAt !== null && !isIsoDate(state.consentGrantedAt)) ||
    !statuses.includes(state.modelStatus as SemanticModelStatus) ||
    (state.backend !== null &&
      state.backend !== "webgpu" &&
      state.backend !== "wasm") ||
    !Number.isSafeInteger(state.indexedBookmarks) ||
    (state.indexedBookmarks as number) < 0 ||
    (state.updatedAt !== null && !isIsoDate(state.updatedAt)) ||
    (state.errorCode !== null && typeof state.errorCode !== "string")
  ) {
    return null;
  }
  return structuredClone(state) as unknown as SemanticSearchState;
}

export class SemanticStateRepository {
  constructor(
    private readonly storage: StorageArea,
    private readonly now = () => new Date(),
  ) {}

  async get(): Promise<SemanticSearchState> {
    const values = await this.storage.get(SEMANTIC_STATE_KEY);
    return (
      parseState(values[SEMANTIC_STATE_KEY]) ?? structuredClone(DEFAULT_SEMANTIC_STATE)
    );
  }

  async beginConsentInstall(): Promise<SemanticSearchState> {
    const now = this.now().toISOString();
    return this.write({
      enabled: true,
      consentGrantedAt: now,
      modelStatus: "downloading",
      backend: null,
      indexedBookmarks: 0,
      updatedAt: now,
      errorCode: null,
    });
  }

  async markIndexing(backend: "webgpu" | "wasm"): Promise<SemanticSearchState> {
    const current = await this.get();
    return this.write({
      ...current,
      modelStatus: "indexing",
      backend,
      updatedAt: this.now().toISOString(),
      errorCode: null,
    });
  }

  async markReady(
    backend: "webgpu" | "wasm",
    indexedBookmarks: number,
  ): Promise<SemanticSearchState> {
    const current = await this.get();
    return this.write({
      ...current,
      enabled: current.consentGrantedAt !== null,
      modelStatus: "ready",
      backend,
      indexedBookmarks,
      updatedAt: this.now().toISOString(),
      errorCode: null,
    });
  }

  async markError(errorCode: string): Promise<SemanticSearchState> {
    const current = await this.get();
    return this.write({
      ...current,
      modelStatus: "error",
      updatedAt: this.now().toISOString(),
      errorCode: errorCode.slice(0, 80),
    });
  }

  async markCancelled(): Promise<SemanticSearchState> {
    const current = await this.get();
    return this.write({
      ...current,
      modelStatus: "notInstalled",
      backend: null,
      indexedBookmarks: 0,
      updatedAt: this.now().toISOString(),
      errorCode: null,
    });
  }

  async setEnabled(enabled: boolean): Promise<SemanticSearchState> {
    const current = await this.get();
    return this.write({
      ...current,
      enabled: enabled && current.modelStatus === "ready",
    });
  }

  reset(): Promise<SemanticSearchState> {
    return this.write(structuredClone(DEFAULT_SEMANTIC_STATE));
  }

  private async write(state: SemanticSearchState): Promise<SemanticSearchState> {
    await this.storage.set({
      [SEMANTIC_STATE_KEY]: {
        schemaVersion: SEMANTIC_STATE_SCHEMA_VERSION,
        state,
      },
    });
    return structuredClone(state);
  }
}
