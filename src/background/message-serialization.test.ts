import { describe, expect, it, vi } from "vitest";

import { KeyedTaskQueue, messageSerializationKey } from "./message-serialization";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("KeyedTaskQueue", () => {
  it("preserves order for mutations of the same bookmark", async () => {
    const queue = new KeyedTaskQueue();
    const gate = deferred();
    const events: string[] = [];
    const key = messageSerializationKey({
      type: "SAVE_BOOKMARK_NOTE",
      payload: { id: "100", note: "first" },
    });

    const first = queue.run(key, async () => {
      events.push("first:start");
      await gate.promise;
      events.push("first:end");
    });
    const second = queue.run(
      messageSerializationKey({
        type: "SAVE_BOOKMARK_METADATA",
        payload: { id: "100", note: "second", tags: [], folder: null },
      }),
      async () => {
        events.push("second:start");
        events.push("second:end");
      },
    );

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    gate.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("runs mutations for independent bookmarks in parallel", async () => {
    const queue = new KeyedTaskQueue();
    const gate = deferred();
    const started = vi.fn();
    const mutation = (id: string) =>
      queue.run(
        messageSerializationKey({
          type: "SAVE_BOOKMARK_NOTE",
          payload: { id, note: id },
        }),
        async () => {
          started(id);
          await gate.promise;
        },
      );

    const first = mutation("100");
    const second = mutation("200");
    await Promise.resolve();

    expect(started).toHaveBeenCalledTimes(2);
    gate.resolve();
    await Promise.all([first, second]);
  });

  it("waits for every conflicting key of a multi-resource mutation", async () => {
    const queue = new KeyedTaskQueue();
    const firstGate = deferred();
    const secondGate = deferred();
    const combined = vi.fn();
    const first = queue.run("bookmark:100", () => firstGate.promise);
    const second = queue.run("scrape", () => secondGate.promise);
    const shared = queue.run(["scrape", "bookmark:100"], combined);

    await Promise.resolve();
    expect(combined).not.toHaveBeenCalled();
    firstGate.resolve();
    await first;
    await Promise.resolve();
    expect(combined).not.toHaveBeenCalled();
    secondGate.resolve();
    await Promise.all([second, shared]);
    expect(combined).toHaveBeenCalledOnce();
  });

  it("does not block a safe read behind a long mutation", async () => {
    const queue = new KeyedTaskQueue();
    const gate = deferred();
    const mutation = queue.run(
      messageSerializationKey({
        type: "SAVE_BOOKMARK_NOTE",
        payload: { id: "100", note: "pending" },
      }),
      () => gate.promise,
    );
    const read = vi.fn(() => Promise.resolve("ready"));

    await expect(
      queue.run(
        messageSerializationKey({ type: "GET_BOOKMARK", payload: { id: "100" } }),
        read,
      ),
    ).resolves.toBe("ready");
    expect(read).toHaveBeenCalledOnce();

    gate.resolve();
    await mutation;
  });

  it("continues a key after a rejected task", async () => {
    const queue = new KeyedTaskQueue();
    const key = "bookmark:100";
    const failure = queue.run(key, () => Promise.reject(new Error("failed")));
    const recovered = queue.run(key, () => Promise.resolve("recovered"));

    await expect(failure).rejects.toThrow("failed");
    await expect(recovered).resolves.toBe("recovered");
  });

  it("removes settled keys instead of growing for the service worker lifetime", async () => {
    const queue = new KeyedTaskQueue();
    await Promise.all(
      Array.from({ length: 1_005 }, (_, index) =>
        queue.run(`bookmark:${index}`, () => Promise.resolve(index)),
      ),
    );

    expect(queue.pendingKeyCount).toBe(0);
  });
});

describe("messageSerializationKey", () => {
  it("groups only conflicting operations", () => {
    expect(
      messageSerializationKey({
        type: "ADD_BOOKMARK_TAG",
        payload: { id: "100", name: "Research" },
      }),
    ).toBe("bookmark:100");
    expect(
      messageSerializationKey({
        type: "ASSIGN_BOOKMARK_FOLDER",
        payload: { bookmarkId: "100", folderId: "folder-a" },
      }),
    ).toBe("bookmark:100");
    expect(
      messageSerializationKey({
        type: "SCRAPE_BATCH",
        runId: "run-1",
        bookmarks: [{ id: "100" }, { id: "200" }],
      }),
    ).toEqual(["scrape", "bookmark:100", "bookmark:200"]);
    expect(
      messageSerializationKey({
        type: "LIVE_BOOKMARK_CANCELLED",
        intentId: "intent-1",
      }),
    ).toBe("live:intent-1");
    expect(
      messageSerializationKey({
        type: "LIVE_BOOKMARK_CONFIRMED",
        intentId: "intent-1",
        bookmark: { id: "100" },
      }),
    ).toEqual(["live:intent-1", "bookmark:100"]);
    expect(messageSerializationKey({ type: "GET_STATUS" })).toBeNull();
    expect(messageSerializationKey({ type: "LIST_TAGS" })).toBeNull();
    expect(messageSerializationKey({ type: "invalid" })).toBeNull();
  });
});
