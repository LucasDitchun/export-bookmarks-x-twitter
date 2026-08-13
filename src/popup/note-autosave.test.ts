import { describe, expect, it, vi } from "vitest";

import type { NotedBookmark, SendMessage, UiRequest } from "./protocol";
import { createNoteAutosave } from "./note-autosave";

const bookmark = {
  id: "123",
  note: "",
} as NotedBookmark;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("createNoteAutosave", () => {
  it("serializes drafts and applies only the latest visible response", async () => {
    const first = deferred<{ ok: true; data: { bookmark: NotedBookmark } }>();
    const second = deferred<{ ok: true; data: { bookmark: NotedBookmark } }>();
    const requests: Array<{ id: string; note: string }> = [];
    const sendMessage = vi.fn((request: UiRequest) => {
      if (request.type !== "SAVE_BOOKMARK_NOTE") {
        return Promise.resolve({ ok: true as const, data: undefined });
      }
      requests.push(request.payload);
      return requests.length === 1 ? first.promise : second.promise;
    }) as SendMessage;
    const scheduled: Array<() => void> = [];
    let visibleNote = "";
    const onSaved = vi.fn();
    const onStatus = vi.fn();
    const autosave = createNoteAutosave({
      sendMessage,
      schedule: ((callback: () => void) => {
        scheduled.push(callback);
        return scheduled.length;
      }) as typeof window.setTimeout,
      cancelSchedule: vi.fn(),
      getVisibleDraft: () => ({ id: "123", note: visibleNote }),
      onSaved,
      onStatus,
    });
    autosave.select("123");

    visibleNote = "first";
    autosave.stage(visibleNote);
    scheduled.shift()?.();
    await Promise.resolve();
    visibleNote = "latest";
    autosave.stage(visibleNote);
    scheduled.shift()?.();
    expect(requests).toEqual([{ id: "123", note: "first" }]);

    first.resolve({ ok: true, data: { bookmark: { ...bookmark, note: "first" } } });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(onSaved).not.toHaveBeenCalled();
    second.resolve({ ok: true, data: { bookmark: { ...bookmark, note: "latest" } } });
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(onStatus).toHaveBeenLastCalledWith("noteSaved");
    autosave.destroy();
  });
});
