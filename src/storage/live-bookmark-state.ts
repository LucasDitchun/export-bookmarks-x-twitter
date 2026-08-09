import type { LiveBookmarkContext } from "../shared/protocol";
import type { StorageArea } from "./extension-state";

export const LIVE_BOOKMARK_CONTEXT_KEY = "liveBookmarkContext";
const LIVE_BOOKMARK_STATE_SCHEMA_VERSION = 1 as const;
const MAX_CONTEXTS_PER_TAB = 24;
const CONTEXT_TTL_MS = 30_000;

interface StoredLiveBookmarkContexts {
  schemaVersion: typeof LIVE_BOOKMARK_STATE_SCHEMA_VERSION;
  contexts: LiveBookmarkContext[];
}

interface LiveBookmarkStateOptions {
  now?: () => Date;
}

export function isLiveBookmarkContext(value: unknown): value is LiveBookmarkContext {
  if (typeof value !== "object" || value === null) return false;
  const context = value as Partial<LiveBookmarkContext>;
  return (
    typeof context.intentId === "string" &&
    (context.action === "save" || context.action === "remove") &&
    ["pending", "saved", "archived", "cancelled"].includes(String(context.state)) &&
    typeof context.updatedAt === "string" &&
    typeof context.bookmark === "object" &&
    context.bookmark !== null &&
    typeof context.bookmark.id === "string" &&
    typeof context.bookmark.text === "string" &&
    typeof context.bookmark.url === "string" &&
    typeof context.bookmark.postCreatedAt === "string" &&
    typeof context.bookmark.author === "object" &&
    context.bookmark.author !== null &&
    typeof context.bookmark.author.id === "string" &&
    typeof context.bookmark.author.username === "string" &&
    typeof context.bookmark.author.name === "string"
  );
}

function tabContextKey(tabId: number): string {
  return `${LIVE_BOOKMARK_CONTEXT_KEY}:${tabId}`;
}

export class LiveBookmarkStateRepository {
  private readonly now: () => Date;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: Pick<StorageArea, "get" | "set">,
    options: LiveBookmarkStateOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  private activeContexts(value: unknown): LiveBookmarkContext[] {
    if (
      typeof value !== "object" ||
      value === null ||
      (value as Partial<StoredLiveBookmarkContexts>).schemaVersion !==
        LIVE_BOOKMARK_STATE_SCHEMA_VERSION ||
      !Array.isArray((value as Partial<StoredLiveBookmarkContexts>).contexts)
    ) {
      return [];
    }
    const cutoff = this.now().valueOf() - CONTEXT_TTL_MS;
    return (value as StoredLiveBookmarkContexts).contexts.filter((context) => {
      if (!isLiveBookmarkContext(context)) return false;
      const updatedAt = new Date(context.updatedAt).valueOf();
      return !Number.isNaN(updatedAt) && updatedAt >= cutoff;
    });
  }

  async get(tabId: number, intentId: string): Promise<LiveBookmarkContext | null> {
    const key = tabContextKey(tabId);
    const contexts = this.activeContexts((await this.storage.get(key))[key]);
    return contexts.find((context) => context.intentId === intentId) ?? null;
  }

  async set(tabId: number, context: LiveBookmarkContext): Promise<void> {
    const operation = this.writeQueue.then(() => this.write(tabId, context));
    this.writeQueue = operation.catch(() => undefined);
    await operation;
  }

  private async write(tabId: number, context: LiveBookmarkContext): Promise<void> {
    const key = tabContextKey(tabId);
    const current = this.activeContexts((await this.storage.get(key))[key]).filter(
      ({ intentId }) => intentId !== context.intentId,
    );
    const contexts = [...current, context].slice(-MAX_CONTEXTS_PER_TAB);
    await this.storage.set({
      [key]: {
        schemaVersion: LIVE_BOOKMARK_STATE_SCHEMA_VERSION,
        contexts,
      } satisfies StoredLiveBookmarkContexts,
      [LIVE_BOOKMARK_CONTEXT_KEY]: context,
    });
  }
}
