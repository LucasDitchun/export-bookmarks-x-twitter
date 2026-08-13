export type MessageSerializationKey = string | readonly string[] | null;

type UnknownRequest = {
  type?: unknown;
  payload?: unknown;
  intentId?: unknown;
  bookmark?: unknown;
  bookmarks?: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function payloadId(request: UnknownRequest, property = "id"): string | null {
  const value = record(request.payload)?.[property];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function bookmarkId(request: UnknownRequest): string | null {
  const value = record(request.bookmark)?.id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function liveIntentKey(request: UnknownRequest): string | null {
  return typeof request.intentId === "string" && request.intentId.length > 0
    ? `live:${request.intentId}`
    : null;
}

export function messageSerializationKey(value: unknown): MessageSerializationKey {
  const request = record(value) as UnknownRequest | null;
  if (request === null || typeof request.type !== "string") return null;

  switch (request.type) {
    case "SAVE_BOOKMARK_NOTE":
    case "SAVE_BOOKMARK_METADATA":
    case "ADD_BOOKMARK_TAG":
    case "REMOVE_BOOKMARK_TAG": {
      const id = payloadId(request);
      return id === null ? null : `bookmark:${id}`;
    }
    case "ASSIGN_BOOKMARK_FOLDER": {
      const id = payloadId(request, "bookmarkId");
      return id === null ? null : `bookmark:${id}`;
    }
    case "RENAME_TAG":
    case "DELETE_TAG":
    case "RESTORE_TAG": {
      const id = payloadId(request);
      return id === null ? null : `tag:${id}`;
    }
    case "CREATE_FOLDER":
    case "RENAME_FOLDER":
    case "DELETE_FOLDER":
    case "RESTORE_FOLDER":
      return "folders";
    case "SAVE_SETTINGS":
      return "settings";
    case "START_SCRAPE":
    case "CANCEL_SCRAPE":
    case "SCRAPE_BATCH": {
      const keys = ["scrape"];
      if (Array.isArray(request.bookmarks)) {
        for (const bookmark of request.bookmarks) {
          const id = record(bookmark)?.id;
          if (typeof id === "string" && id.length > 0) keys.push(`bookmark:${id}`);
        }
      }
      return keys;
    }
    case "SCRAPE_PROGRESS":
    case "SCRAPE_COMPLETE":
    case "SCRAPE_FAILED":
      return "scrape";
    case "LIVE_BOOKMARK_PENDING":
    case "LIVE_BOOKMARK_CANCELLED":
      return liveIntentKey(request);
    case "LIVE_BOOKMARK_CONFIRMED": {
      const intentKey = liveIntentKey(request);
      const id = bookmarkId(request);
      if (intentKey === null) return id === null ? null : `bookmark:${id}`;
      return id === null ? intentKey : [intentKey, `bookmark:${id}`];
    }
    case "CLEAR_ARCHIVE":
    case "RESTORE_BACKUP":
      return "library";
    default:
      return null;
  }
}

export function isGlobalSerializationBarrier(value: unknown): boolean {
  const request = record(value);
  return request?.type === "CLEAR_ARCHIVE" || request?.type === "RESTORE_BACKUP";
}

export function isGlobalSerializationBarrierAwareRead(value: unknown): boolean {
  return record(value)?.type === "EXPORT_BACKUP";
}

interface TaskQueueOptions {
  globalBarrier?: boolean;
  waitForGlobalBarrier?: boolean;
}

export class KeyedTaskQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly pendingMutations = new Set<Promise<void>>();
  private readonly pendingBarrierAwareReads = new Set<Promise<void>>();
  private globalBarrierTail: Promise<void> | null = null;

  get pendingKeyCount(): number {
    return this.tails.size;
  }

  get pendingMutationCount(): number {
    return this.pendingMutations.size;
  }

  get pendingBarrierAwareReadCount(): number {
    return this.pendingBarrierAwareReads.size;
  }

  run<T>(
    key: MessageSerializationKey,
    task: () => Promise<T> | T,
    options: TaskQueueOptions = {},
  ): Promise<T> {
    const keys = [
      ...new Set(key === null ? [] : typeof key === "string" ? [key] : key),
    ];
    const globalBarrier = options.globalBarrier === true;
    const waitForGlobalBarrier = options.waitForGlobalBarrier === true;
    if (keys.length === 0 && !globalBarrier && !waitForGlobalBarrier) {
      return Promise.resolve().then(task);
    }

    const dependencies = globalBarrier
      ? [...this.pendingMutations, ...this.pendingBarrierAwareReads]
      : keys.flatMap((currentKey) => {
          const pending = this.tails.get(currentKey);
          return pending === undefined ? [] : [pending];
        });
    if (!globalBarrier && this.globalBarrierTail !== null) {
      dependencies.push(this.globalBarrierTail);
    }
    const previous =
      dependencies.length === 0 ? Promise.resolve() : Promise.all(dependencies);
    const result = previous.then(task);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    if (keys.length === 0 && !globalBarrier) {
      this.pendingBarrierAwareReads.add(settled);
      void settled.then(() => this.pendingBarrierAwareReads.delete(settled));
      return result;
    }
    for (const currentKey of keys) this.tails.set(currentKey, settled);
    this.pendingMutations.add(settled);
    if (globalBarrier) this.globalBarrierTail = settled;
    void settled.then(() => {
      for (const currentKey of keys) {
        if (this.tails.get(currentKey) === settled) this.tails.delete(currentKey);
      }
      this.pendingMutations.delete(settled);
      if (this.globalBarrierTail === settled) this.globalBarrierTail = null;
    });
    return result;
  }
}
