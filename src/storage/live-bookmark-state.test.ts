import { describe, expect, it } from "vitest";

import type { LiveBookmarkContext } from "../shared/protocol";
import {
  LIVE_BOOKMARK_CONTEXT_KEY,
  LiveBookmarkStateRepository,
} from "./live-bookmark-state";

const context: LiveBookmarkContext = {
  intentId: "intent-1",
  action: "save",
  state: "pending",
  bookmark: {
    id: "123",
    text: "Post",
    url: "https://x.com/alice/status/123",
    author: { id: "alice", username: "alice", name: "Alice" },
    postCreatedAt: "2026-08-09T09:00:00.000Z",
  },
  updatedAt: "2026-08-09T09:01:00.000Z",
};

describe("LiveBookmarkStateRepository", () => {
  it("isolates concurrent intents by tab and intent and publishes the latest", async () => {
    const values: Record<string, unknown> = {};
    const repository = new LiveBookmarkStateRepository(
      {
        get: async (key) => ({ [key as string]: values[key as string] }),
        set: async (items) => {
          Object.assign(values, items);
        },
      },
      { now: () => new Date("2026-08-09T09:01:05.000Z") },
    );
    const other = {
      ...context,
      intentId: "intent-2",
      bookmark: { ...context.bookmark, id: "456" },
    };

    await repository.set(7, context);
    await repository.set(7, other);

    await expect(repository.get(7, "intent-1")).resolves.toEqual(context);
    await expect(repository.get(7, "intent-2")).resolves.toEqual(other);
    expect(values[LIVE_BOOKMARK_CONTEXT_KEY]).toEqual(other);
  });

  it("rejects malformed stored contexts", async () => {
    const repository = new LiveBookmarkStateRepository(
      {
        get: async (key) => ({
          [key as string]: {
            schemaVersion: 1,
            contexts: [{ ...context, action: "inject" }],
          },
        }),
        set: async () => undefined,
      },
      { now: () => new Date("2026-08-09T09:01:05.000Z") },
    );
    await expect(repository.get(7, "intent-1")).resolves.toBeNull();
  });

  it("serializes concurrent writes so pending intents cannot overwrite each other", async () => {
    const values: Record<string, unknown> = {};
    const repository = new LiveBookmarkStateRepository(
      {
        get: async (key) => {
          await Promise.resolve();
          return { [key as string]: values[key as string] };
        },
        set: async (items) => {
          await Promise.resolve();
          Object.assign(values, items);
        },
      },
      { now: () => new Date("2026-08-09T09:01:05.000Z") },
    );
    const other = {
      ...context,
      intentId: "intent-2",
      bookmark: { ...context.bookmark, id: "456" },
    };

    await Promise.all([repository.set(7, context), repository.set(7, other)]);

    await expect(repository.get(7, "intent-1")).resolves.toEqual(context);
    await expect(repository.get(7, "intent-2")).resolves.toEqual(other);
  });

  it("expires stale intents and bounds retained state per tab", async () => {
    const values: Record<string, unknown> = {};
    const repository = new LiveBookmarkStateRepository(
      {
        get: async (key) => ({ [key as string]: values[key as string] }),
        set: async (items) => {
          Object.assign(values, items);
        },
      },
      { now: () => new Date("2026-08-09T09:01:05.000Z") },
    );
    await repository.set(7, {
      ...context,
      intentId: "expired",
      updatedAt: "2026-08-09T09:00:00.000Z",
    });
    for (let index = 1; index <= 25; index += 1) {
      await repository.set(7, { ...context, intentId: `bounded-${index}` });
    }

    await expect(repository.get(7, "expired")).resolves.toBeNull();
    await expect(repository.get(7, "bounded-1")).resolves.toBeNull();
    await expect(repository.get(7, "bounded-25")).resolves.toMatchObject({
      intentId: "bounded-25",
    });
  });
});
