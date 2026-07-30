import { describe, expect, it } from "vitest";

import { ArchiveRepository } from "./archive-repository";
import type { BookmarkSnapshot } from "../domain/types";

const syncedBookmark: BookmarkSnapshot = {
  id: "post-1",
  text: "Original text",
  url: "https://x.com/author/status/post-1",
  author: { id: "author-1", username: "author", name: "Author" },
  postCreatedAt: "2025-01-01T00:00:00.000Z",
};

describe("ArchiveRepository", () => {
  it("merges by post ID while preserving the first archive time", async () => {
    const repository = new ArchiveRepository(`test-${crypto.randomUUID()}`);

    await expect(
      repository.mergeBookmarks(
        [syncedBookmark],
        "capture-1",
        "2026-01-01T00:00:00.000Z",
      ),
    ).resolves.toEqual({ added: 1, updated: 0 });
    await expect(
      repository.mergeBookmarks(
        [{ ...syncedBookmark, text: "Edited text" }],
        "capture-2",
        "2026-02-01T00:00:00.000Z",
      ),
    ).resolves.toEqual({ added: 0, updated: 1 });

    await expect(repository.getAll()).resolves.toEqual([
      expect.objectContaining({
        id: "post-1",
        text: "Edited text",
        firstArchivedAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-02-01T00:00:00.000Z",
      }),
    ]);
  });

  it("archives missing records only after a complete capture is finalized", async () => {
    const repository = new ArchiveRepository(`test-${crypto.randomUUID()}`);
    await repository.mergeBookmarks(
      [syncedBookmark],
      "capture-1",
      "2026-01-01T00:00:00.000Z",
    );
    await repository.finalizeCapture("capture-1", "2026-01-01T00:05:00.000Z");

    await repository.mergeBookmarks(
      [{ ...syncedBookmark, id: "post-2" }],
      "capture-2",
      "2026-02-01T00:00:00.000Z",
    );
    await repository.finalizeCapture("capture-2", "2026-02-01T00:05:00.000Z");

    const records = await repository.getAll();
    expect(records.find((record) => record.id === "post-1")?.isCurrent).toBe(false);
    expect(records.find((record) => record.id === "post-2")?.isCurrent).toBe(true);
    await expect(repository.getStats()).resolves.toEqual({
      total: 2,
      current: 1,
      archived: 1,
      lastSuccessfulSyncAt: "2026-02-01T00:05:00.000Z",
    });
  });

  it("does not archive missing records after a partial capture and clears on request", async () => {
    const repository = new ArchiveRepository(`test-${crypto.randomUUID()}`);
    await repository.mergeBookmarks(
      [syncedBookmark],
      "capture-1",
      "2026-01-01T00:00:00.000Z",
    );
    await repository.finalizeCapture("capture-1", "2026-01-01T00:01:00.000Z");

    await repository.mergeBookmarks(
      [{ ...syncedBookmark, id: "post-2" }],
      "capture-cancelled",
      "2026-02-01T00:00:00.000Z",
    );

    expect(
      (await repository.getAll()).find(({ id }) => id === "post-1")?.isCurrent,
    ).toBe(true);
    await repository.clear();
    await expect(repository.getAll()).resolves.toEqual([]);
    await expect(repository.getStats()).resolves.toEqual({
      total: 0,
      current: 0,
      archived: 0,
      lastSuccessfulSyncAt: null,
    });
  });
});
