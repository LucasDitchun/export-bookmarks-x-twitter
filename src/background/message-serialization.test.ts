import { describe, expect, it, vi } from "vitest";

import {
  isGlobalSerializationBarrierAwareRead,
  isGlobalSerializationBarrier,
  KeyedTaskQueue,
  messageSerializationKey,
} from "./message-serialization";

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

  it.each(["RESTORE_BACKUP", "CLEAR_ARCHIVE"])(
    "%s waits for prior mutations and blocks every later mutation",
    async (barrierType) => {
      const queue = new KeyedTaskQueue();
      const priorGate = deferred();
      const barrierGate = deferred();
      const events: string[] = [];
      const priorRequests = [
        { type: "SAVE_BOOKMARK_METADATA", payload: { id: "100" } },
        { type: "SAVE_SETTINGS", payload: {} },
        { type: "START_SCRAPE" },
        {
          type: "LIVE_BOOKMARK_CONFIRMED",
          intentId: "intent-before",
          bookmark: { id: "200" },
        },
      ];
      const prior = priorRequests.map((request, index) =>
        queue.run(messageSerializationKey(request), async () => {
          events.push(`prior:${index}:start`);
          await priorGate.promise;
          events.push(`prior:${index}:end`);
        }),
      );
      const barrierRequest = { type: barrierType };
      const barrier = queue.run(
        messageSerializationKey(barrierRequest),
        async () => {
          events.push("barrier:start");
          await barrierGate.promise;
          events.push("barrier:end");
        },
        { globalBarrier: isGlobalSerializationBarrier(barrierRequest) },
      );
      const laterRequests = [
        { type: "SAVE_BOOKMARK_NOTE", payload: { id: "300" } },
        { type: "SAVE_SETTINGS", payload: {} },
        { type: "START_SCRAPE" },
        {
          type: "LIVE_BOOKMARK_CONFIRMED",
          intentId: "intent-after",
          bookmark: { id: "400" },
        },
      ];
      const later = laterRequests.map((request, index) =>
        queue.run(messageSerializationKey(request), async () => {
          events.push(`later:${index}`);
        }),
      );

      await Promise.resolve();
      expect(events).toEqual([
        "prior:0:start",
        "prior:1:start",
        "prior:2:start",
        "prior:3:start",
      ]);
      priorGate.resolve();
      await Promise.all(prior);
      await vi.waitFor(() => expect(events).toContain("barrier:start"));
      expect(events).not.toContain("later:0");
      barrierGate.resolve();
      await Promise.all([barrier, ...later]);
      expect(events.slice(-5)).toEqual([
        "barrier:end",
        "later:0",
        "later:1",
        "later:2",
        "later:3",
      ]);
    },
  );

  it("does not poison later mutations when a global barrier rejects", async () => {
    const queue = new KeyedTaskQueue();
    const barrierRequest = { type: "RESTORE_BACKUP" };
    const barrier = queue.run(
      messageSerializationKey(barrierRequest),
      () => Promise.reject(new Error("restore failed")),
      { globalBarrier: isGlobalSerializationBarrier(barrierRequest) },
    );
    const later = queue.run("bookmark:100", () => Promise.resolve("saved"));

    await expect(barrier).rejects.toThrow("restore failed");
    await expect(later).resolves.toBe("saved");
    await Promise.resolve();
    expect(queue.pendingKeyCount).toBe(0);
    expect(queue.pendingMutationCount).toBe(0);
  });

  it("runs a global barrier after a prior mutation rejects", async () => {
    const queue = new KeyedTaskQueue();
    const prior = queue.run("settings", () => Promise.reject(new Error("save failed")));
    const barrierRequest = { type: "CLEAR_ARCHIVE" };
    const barrier = queue.run(
      messageSerializationKey(barrierRequest),
      () => Promise.resolve("cleared"),
      { globalBarrier: isGlobalSerializationBarrier(barrierRequest) },
    );

    await expect(prior).rejects.toThrow("save failed");
    await expect(barrier).resolves.toBe("cleared");
    await Promise.resolve();
    expect(queue.pendingMutationCount).toBe(0);
  });

  it("keeps safe reads independent from a global destructive barrier", async () => {
    const queue = new KeyedTaskQueue();
    const gate = deferred();
    const barrierRequest = { type: "CLEAR_ARCHIVE" };
    const barrier = queue.run(
      messageSerializationKey(barrierRequest),
      () => gate.promise,
      { globalBarrier: isGlobalSerializationBarrier(barrierRequest) },
    );

    await expect(queue.run(null, () => Promise.resolve("status"))).resolves.toBe(
      "status",
    );
    gate.resolve();
    await barrier;
  });

  it("waits to export a backup until an active destructive barrier settles", async () => {
    const queue = new KeyedTaskQueue();
    const gate = deferred();
    const events: string[] = [];
    const barrierRequest = { type: "RESTORE_BACKUP" };
    const barrier = queue.run(
      messageSerializationKey(barrierRequest),
      async () => {
        events.push("restore:start");
        await gate.promise;
        events.push("restore:end");
      },
      { globalBarrier: true },
    );
    const exportRequest = { type: "EXPORT_BACKUP" };
    const exported = queue.run(
      messageSerializationKey(exportRequest),
      async () => events.push("export"),
      { waitForGlobalBarrier: isGlobalSerializationBarrierAwareRead(exportRequest) },
    );
    const status = queue.run(null, async () => events.push("status"));

    await status;
    expect(events).toEqual(["restore:start", "status"]);
    gate.resolve();
    await Promise.all([barrier, exported]);
    expect(events).toEqual(["restore:start", "status", "restore:end", "export"]);
  });

  it("keeps backup exports free without a barrier and recovers after barrier errors", async () => {
    const queue = new KeyedTaskQueue();
    const mutationGate = deferred();
    const mutation = queue.run("bookmark:100", () => mutationGate.promise);
    const exportRequest = { type: "EXPORT_BACKUP" };

    await expect(
      queue.run(null, () => Promise.resolve("snapshot"), {
        waitForGlobalBarrier: isGlobalSerializationBarrierAwareRead(exportRequest),
      }),
    ).resolves.toBe("snapshot");

    const barrierRequest = { type: "RESTORE_BACKUP" };
    mutationGate.resolve();
    await mutation;
    const failedBarrier = queue.run(
      messageSerializationKey(barrierRequest),
      () => Promise.reject(new Error("restore failed")),
      { globalBarrier: true },
    );
    const exportAfterFailure = queue.run(null, () => Promise.resolve("recovered"), {
      waitForGlobalBarrier: true,
    });

    await expect(failedBarrier).rejects.toThrow("restore failed");
    await expect(exportAfterFailure).resolves.toBe("recovered");
    await expect(
      queue.run(null, () => Promise.resolve("next"), { waitForGlobalBarrier: true }),
    ).resolves.toBe("next");
    expect(queue.pendingKeyCount).toBe(0);
    expect(queue.pendingMutationCount).toBe(0);
  });

  it("keeps a restore from mixing settings into an earlier backup snapshot", async () => {
    const queue = new KeyedTaskQueue();
    const idbRead = deferred();
    let idb = "old";
    let settings = "old";
    let snapshot: { idb: string; settings: string } | null = null;

    const exported = queue.run(
      null,
      async () => {
        const capturedIdb = idb;
        await idbRead.promise;
        snapshot = { idb: capturedIdb, settings };
      },
      { waitForGlobalBarrier: true },
    );
    const restored = queue.run(
      "library",
      async () => {
        idb = "new";
        settings = "new";
      },
      { globalBarrier: true },
    );

    await Promise.resolve();
    expect(idb).toBe("old");
    idbRead.resolve();
    await Promise.all([exported, restored]);
    expect(snapshot).toEqual({ idb: "old", settings: "old" });
    expect({ idb, settings }).toEqual({ idb: "new", settings: "new" });
  });

  it("runs concurrent backup snapshots in parallel when no barrier exists", async () => {
    const queue = new KeyedTaskQueue();
    const gate = deferred();
    const started = vi.fn();
    const exportSnapshot = (id: string) =>
      queue.run(
        null,
        async () => {
          started(id);
          await gate.promise;
        },
        { waitForGlobalBarrier: true },
      );

    const first = exportSnapshot("first");
    const second = exportSnapshot("second");
    await Promise.resolve();
    expect(started).toHaveBeenCalledTimes(2);
    expect(queue.pendingBarrierAwareReadCount).toBe(2);
    gate.resolve();
    await Promise.all([first, second]);
    await Promise.resolve();
    expect(queue.pendingBarrierAwareReadCount).toBe(0);
  });

  it("cleans up a rejected backup snapshot before a later barrier", async () => {
    const queue = new KeyedTaskQueue();
    const failed = queue.run(null, () => Promise.reject(new Error("export failed")), {
      waitForGlobalBarrier: true,
    });
    const restored = queue.run("library", () => Promise.resolve("restored"), {
      globalBarrier: true,
    });

    await expect(failed).rejects.toThrow("export failed");
    await expect(restored).resolves.toBe("restored");
    await Promise.resolve();
    expect(queue.pendingBarrierAwareReadCount).toBe(0);
    expect(queue.pendingMutationCount).toBe(0);
  });

  it("removes settled keys instead of growing for the service worker lifetime", async () => {
    const queue = new KeyedTaskQueue();
    await Promise.all(
      Array.from({ length: 1_005 }, (_, index) =>
        queue.run(`bookmark:${index}`, () => Promise.resolve(index)),
      ),
    );

    expect(queue.pendingKeyCount).toBe(0);
    expect(queue.pendingMutationCount).toBe(0);
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
    expect(isGlobalSerializationBarrier({ type: "RESTORE_BACKUP" })).toBe(true);
    expect(isGlobalSerializationBarrier({ type: "CLEAR_ARCHIVE" })).toBe(true);
    expect(isGlobalSerializationBarrier({ type: "SAVE_SETTINGS" })).toBe(false);
    expect(isGlobalSerializationBarrierAwareRead({ type: "EXPORT_BACKUP" })).toBe(true);
    expect(isGlobalSerializationBarrierAwareRead({ type: "GET_STATUS" })).toBe(false);
  });
});
