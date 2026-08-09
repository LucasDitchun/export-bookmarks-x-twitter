import { describe, expect, it } from "vitest";

import type { BookmarkRecord } from "../domain/types";
import { BookmarkDatabase, transactionDone } from "./bookmark-database";
import { BookmarkRepository } from "./bookmark-repository";

function record(
  id: string,
  firstSavedAt: string,
  overrides: Partial<BookmarkRecord> = {},
): BookmarkRecord {
  return {
    id,
    text: `Post ${id}`,
    url: `https://x.com/author/status/${id}`,
    author: { id: "author-1", username: "author", name: "Author" },
    postCreatedAt: "2025-01-01T00:00:00.000Z",
    media: { images: [], videos: [] },
    note: "",
    folderId: null,
    tagIds: [],
    firstSavedAt,
    lastSeenAt: firstSavedAt,
    archivedAt: null,
    metadataUpdatedAt: firstSavedAt,
    status: "current",
    ...overrides,
  };
}

async function seed(
  databaseName: string,
  records: readonly BookmarkRecord[],
): Promise<void> {
  const database = await new BookmarkDatabase(databaseName).open();
  const transaction = database.transaction("bookmarks", "readwrite");
  for (const bookmark of records) {
    transaction.objectStore("bookmarks").put(bookmark);
  }
  await transactionDone(transaction);
  database.close();
}

describe("BookmarkRepository", () => {
  it("paginates a view by firstSavedAt and id using an opaque cursor", async () => {
    const databaseName = `list-${crypto.randomUUID()}`;
    await seed(databaseName, [
      record("100", "2026-01-01T00:00:00.000Z"),
      record("200", "2026-02-01T00:00:00.000Z"),
      record("300", "2026-02-01T00:00:00.000Z"),
      record("400", "2026-03-01T00:00:00.000Z", {
        archivedAt: "2026-04-01T00:00:00.000Z",
        status: "archived",
      }),
    ]);
    const repository = new BookmarkRepository(databaseName);

    const firstPage = await repository.list({ view: "current", limit: 2 });
    expect(firstPage.items.map(({ id }) => id)).toEqual(["300", "200"]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(firstPage.nextCursor).not.toContain("200");
    if (firstPage.nextCursor === null) throw new Error("Expected a second page.");

    await expect(
      repository.list({
        view: "current",
        cursor: firstPage.nextCursor,
        limit: 2,
      }),
    ).resolves.toEqual({
      items: [record("100", "2026-01-01T00:00:00.000Z")],
      nextCursor: null,
    });
    await expect(repository.list({ view: "archived", limit: 10 })).resolves.toEqual({
      items: [
        record("400", "2026-03-01T00:00:00.000Z", {
          archivedAt: "2026-04-01T00:00:00.000Z",
          status: "archived",
        }),
      ],
      nextCursor: null,
    });
  });

  it("lists inbox as current bookmarks with any empty organization metadata", async () => {
    const databaseName = `inbox-${crypto.randomUUID()}`;
    await seed(databaseName, [
      record("100", "2026-01-01T00:00:00.000Z", {
        note: "Done",
        folderId: "folder-1",
        tagIds: ["tag-1"],
      }),
      record("200", "2026-02-01T00:00:00.000Z", {
        note: "Done",
        folderId: "folder-1",
      }),
      record("300", "2026-03-01T00:00:00.000Z", {
        note: "",
        folderId: "folder-1",
        tagIds: ["tag-1"],
        archivedAt: "2026-04-01T00:00:00.000Z",
        status: "archived",
      }),
    ]);
    const repository = new BookmarkRepository(databaseName);

    const page = await repository.list({ view: "inbox", limit: 10 });

    expect(page.items.map(({ id }) => id)).toEqual(["200"]);
    expect(page.nextCursor).toBeNull();
  });

  it("gets a bookmark and saves a plain-text note of at most 20,000 characters", async () => {
    const databaseName = `note-${crypto.randomUUID()}`;
    const original = record("100", "2026-01-01T00:00:00.000Z");
    await seed(databaseName, [original]);
    const repository = new BookmarkRepository(databaseName, {
      now: () => new Date("2026-05-01T12:00:00.000Z"),
    });

    await expect(repository.get("100")).resolves.toEqual(original);
    await expect(repository.get("missing")).resolves.toBeNull();

    const note = `<script>alert("kept as text")</script>${"x".repeat(19_962)}`;
    expect(note).toHaveLength(20_000);
    await expect(repository.saveNote("100", note)).resolves.toEqual({
      ...original,
      note,
      metadataUpdatedAt: "2026-05-01T12:00:00.000Z",
    });
    await expect(repository.saveNote("100", "x".repeat(20_001))).rejects.toThrow(
      /20,000/,
    );
    await expect(repository.saveNote("missing", "note")).rejects.toThrow(/not found/i);
  });

  it("gets multiple requested bookmarks once and preserves request order", async () => {
    const databaseName = `many-${crypto.randomUUID()}`;
    const first = record("100", "2026-01-01T00:00:00.000Z");
    const second = record("200", "2026-02-01T00:00:00.000Z");
    await seed(databaseName, [first, second]);
    const repository = new BookmarkRepository(databaseName);

    await expect(repository.getMany(["200", "missing", "100", "200"])).resolves.toEqual(
      [second, first],
    );
    await expect(repository.getMany([])).resolves.toEqual([]);
  });
});
