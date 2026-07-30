import type { ScrapeRun } from "../domain/types";

const SCRAPE_RUN_KEY = "scrapeRun";

export interface StorageArea {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScrapeRun(value: unknown): value is ScrapeRun {
  if (!isRecord(value)) return false;
  return (
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
    (typeof value.errorCode === "string" || value.errorCode === null)
  );
}

export class ExtensionStateRepository {
  constructor(private readonly storage: StorageArea) {}

  async getScrapeRun(): Promise<ScrapeRun | null> {
    const values = await this.storage.get(SCRAPE_RUN_KEY);
    return isScrapeRun(values[SCRAPE_RUN_KEY]) ? values[SCRAPE_RUN_KEY] : null;
  }

  async setScrapeRun(scrapeRun: ScrapeRun): Promise<void> {
    await this.storage.set({ [SCRAPE_RUN_KEY]: scrapeRun });
  }

  async clearScrapeRun(): Promise<void> {
    await this.storage.remove(SCRAPE_RUN_KEY);
  }
}
