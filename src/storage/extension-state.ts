import type { ScrapeCheckpointState, ScrapeRun } from "../domain/types";

const SCRAPE_RUN_KEY = "scrapeRun";
const SCRAPE_CHECKPOINTS_KEY = "scrapeCheckpoints";

export interface StorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function normalizeScrapeRun(value: unknown): ScrapeRun | null {
  if (!isRecord(value)) return null;
  const valid =
    typeof value.id === "string" &&
    typeof value.tabId === "number" &&
    ["idle", "running", "completed", "cancelled", "error"].includes(
      String(value.status),
    ) &&
    typeof value.fetched === "number" &&
    typeof value.added === "number" &&
    typeof value.updated === "number" &&
    typeof value.startedAt === "string" &&
    typeof value.updatedAt === "string" &&
    (typeof value.errorCode === "string" || value.errorCode === null);
  if (!valid) return null;
  const mode = value.mode === "quick" || value.mode === "full" ? value.mode : "full";
  const checkpointIds = Array.isArray(value.checkpointIds)
    ? value.checkpointIds.filter(
        (id): id is string => typeof id === "string" && /^\d+$/.test(id),
      )
    : [];
  const candidates = Array.isArray(value.checkpointCandidates)
    ? value.checkpointCandidates.filter(
        (id): id is string => typeof id === "string" && /^\d+$/.test(id),
      )
    : [];
  const completionReason = ["checkpoint_stop", "stable_end", "full_fallback"].includes(
    String(value.completionReason),
  )
    ? (value.completionReason as ScrapeRun["completionReason"])
    : null;
  return {
    ...(value as unknown as Omit<
      ScrapeRun,
      | "mode"
      | "checkpointIds"
      | "checkpointCandidates"
      | "checkpointMatchIds"
      | "completionReason"
    >),
    mode,
    checkpointIds: [...new Set(checkpointIds)].slice(0, 10),
    checkpointCandidates: [...new Set(candidates)].slice(0, 10),
    checkpointMatchIds: Array.isArray(value.checkpointMatchIds)
      ? [
          ...new Set(
            value.checkpointMatchIds.filter(
              (id): id is string => typeof id === "string" && /^\d+$/.test(id),
            ),
          ),
        ].slice(-3)
      : [],
    completionReason,
  };
}

function isScrapeCheckpointState(value: unknown): value is ScrapeCheckpointState {
  if (!isRecord(value) || !Array.isArray(value.ids) || !isTimestamp(value.updatedAt)) {
    return false;
  }
  const ids = value.ids;
  return (
    ids.length >= 1 &&
    ids.length <= 10 &&
    ids.every((id) => typeof id === "string" && /^\d+$/.test(id)) &&
    new Set(ids).size === ids.length
  );
}

export class ExtensionStateRepository {
  constructor(private readonly storage: StorageArea) {}

  async getScrapeRun(): Promise<ScrapeRun | null> {
    const values = await this.storage.get(SCRAPE_RUN_KEY);
    return normalizeScrapeRun(values[SCRAPE_RUN_KEY]);
  }

  async setScrapeRun(scrapeRun: ScrapeRun): Promise<void> {
    await this.storage.set({ [SCRAPE_RUN_KEY]: scrapeRun });
  }

  async clearScrapeRun(): Promise<void> {
    await this.storage.remove(SCRAPE_RUN_KEY);
  }

  async getScrapeCheckpoints(): Promise<ScrapeCheckpointState | null> {
    const values = await this.storage.get(SCRAPE_CHECKPOINTS_KEY);
    const checkpoints = values[SCRAPE_CHECKPOINTS_KEY];
    return isScrapeCheckpointState(checkpoints) ? checkpoints : null;
  }

  async setScrapeCheckpoints(checkpoints: ScrapeCheckpointState): Promise<void> {
    if (!isScrapeCheckpointState(checkpoints)) {
      throw new TypeError("Scrape checkpoints are invalid.");
    }
    await this.storage.set({ [SCRAPE_CHECKPOINTS_KEY]: checkpoints });
  }

  async clearScrapeCheckpoints(): Promise<void> {
    await this.storage.remove(SCRAPE_CHECKPOINTS_KEY);
  }
}
