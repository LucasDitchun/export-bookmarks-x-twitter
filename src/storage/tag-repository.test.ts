import { describe, expect, it } from "vitest";

import type { BookmarkRecord } from "../domain/types";
import { BookmarkDatabase, transactionDone } from "./bookmark-database";
import { BookmarkRepository } from "./bookmark-repository";
import { TagRepository } from "./tag-repository";

function record(id: string): BookmarkRecord {
  return {
    id,
    text: `Post ${id}`,
    url: `https://x.com/author/status/${id}`,
    author: { id: "author-1", username: "author", name: "Author" },
    postCreatedAt: "2025-01-01T00:00:00.000Z",
    note: "",
    folderId: null,
    tagIds: [],
    firstSavedAt: "2026-01-01T00:00:00.000Z",
    lastSeenAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    metadataUpdatedAt: "2026-01-01T00:00:00.000Z",
    status: "current",
  };
}

async function seed(databaseName: string, records: BookmarkRecord[]): Promise<void> {
  const database = await new BookmarkDatabase(databaseName).open();
  const transaction = database.transaction("bookmarks", "readwrite");
  for (const bookmark of records) transaction.objectStore("bookmarks").put(bookmark);
  await transactionDone(transaction);
  database.close();
}

async function seedLegacyTags(
  databaseName: string,
  tags: Array<{ id: string; name: string }>,
): Promise<void> {
  const database = await new BookmarkDatabase(databaseName).open();
  const transaction = database.transaction("tags", "readwrite");
  for (const tag of tags) transaction.objectStore("tags").put(tag);
  await transactionDone(transaction);
  database.close();
}

describe("TagRepository", () => {
  it("creates, assigns, and reuses a tag by trimmed Unicode-insensitive name", async () => {
    const databaseName = `tags-${crypto.randomUUID()}`;
    await seed(databaseName, [record("100"), record("200")]);
    const repository = new TagRepository(databaseName, {
      now: () => new Date("2026-05-01T12:00:00.000Z"),
      createId: () => "tag-accessibility",
    });

    const firstAssignment = await repository.add("100", "  Accessibility  ");
    const reusedAssignment = await repository.add("200", "ＡＣＣＥＳＳＩＢＩＬＩＴＹ");

    expect(firstAssignment.tag).toEqual({
      id: "tag-accessibility",
      name: "Accessibility",
      normalizedName: "accessibility",
    });
    expect(firstAssignment.bookmark.tagIds).toEqual(["tag-accessibility"]);
    expect(reusedAssignment.tag).toEqual(firstAssignment.tag);
    expect(reusedAssignment.bookmark.tagIds).toEqual(["tag-accessibility"]);
    await expect(repository.list()).resolves.toEqual([firstAssignment.tag]);
  });

  it("applies Unicode case folding when reusing names", async () => {
    const databaseName = `unicode-tags-${crypto.randomUUID()}`;
    await seed(databaseName, [record("100"), record("200")]);
    const repository = new TagRepository(databaseName, {
      createId: () => "tag-street",
    });

    const first = await repository.add("100", "Straße");
    const reused = await repository.add("200", "STRASSE");

    expect(reused.tag.id).toBe(first.tag.id);
    await expect(repository.list()).resolves.toHaveLength(1);
  });

  it("hydrates and sorts legacy tags that do not have a normalized name", async () => {
    const databaseName = `legacy-tags-${crypto.randomUUID()}`;
    await seed(databaseName, [record("100")]);
    await seedLegacyTags(databaseName, [
      { id: "tag-research", name: "  Ｒｅｓｅａｒｃｈ " },
      { id: "tag-accessibility", name: "Accessibility" },
    ]);
    const repository = new TagRepository(databaseName);

    await expect(repository.list()).resolves.toEqual([
      {
        id: "tag-accessibility",
        name: "Accessibility",
        normalizedName: "accessibility",
      },
      {
        id: "tag-research",
        name: "Research",
        normalizedName: "research",
      },
    ]);
    await expect(repository.add("100", "RESEARCH")).resolves.toMatchObject({
      tag: { id: "tag-research", normalizedName: "research" },
    });
  });

  it("removes only the requested tag and leaves the tag available for reuse", async () => {
    const databaseName = `remove-tag-${crypto.randomUUID()}`;
    await seed(databaseName, [record("100")]);
    let nextId = 0;
    const repository = new TagRepository(databaseName, {
      createId: () => `tag-${++nextId}`,
      now: () => new Date("2026-05-02T12:00:00.000Z"),
    });
    await repository.add("100", "Research");
    await repository.add("100", "Accessibility");

    const updated = await repository.remove("100", "tag-1");

    expect(updated.tagIds).toEqual(["tag-2"]);
    await expect(repository.list()).resolves.toHaveLength(2);
    await expect(repository.remove("100", "tag-1")).resolves.toEqual(updated);
  });

  it("serializes concurrent note and tag updates without losing either field", async () => {
    const databaseName = `concurrent-tag-${crypto.randomUUID()}`;
    await seed(databaseName, [record("100")]);
    const notes = new BookmarkRepository(databaseName, {
      now: () => new Date("2026-05-03T12:00:00.000Z"),
    });
    const tags = new TagRepository(databaseName, {
      createId: () => "tag-research",
      now: () => new Date("2026-05-03T12:00:01.000Z"),
    });

    await Promise.all([
      notes.saveNote("100", "Keep the user's note"),
      tags.add("100", "Research"),
    ]);

    await expect(notes.get("100")).resolves.toMatchObject({
      note: "Keep the user's note",
      tagIds: ["tag-research"],
    });
  });

  it("moves a fully described bookmark out of and back into the Inbox", async () => {
    const databaseName = `tag-inbox-${crypto.randomUUID()}`;
    await seed(databaseName, [
      { ...record("100"), note: "Reviewed", folderId: "folder-1" },
    ]);
    const bookmarks = new BookmarkRepository(databaseName);
    const tags = new TagRepository(databaseName, {
      createId: () => "tag-research",
    });

    await expect(bookmarks.list({ view: "inbox", limit: 10 })).resolves.toMatchObject({
      items: [{ id: "100" }],
    });
    await tags.add("100", "Research");
    await expect(bookmarks.list({ view: "inbox", limit: 10 })).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    await tags.remove("100", "tag-research");
    await expect(bookmarks.list({ view: "inbox", limit: 10 })).resolves.toMatchObject({
      items: [{ id: "100" }],
    });
  });

  it("serializes concurrent normalized tag creation into one reusable tag", async () => {
    const databaseName = `concurrent-tag-create-${crypto.randomUUID()}`;
    await seed(databaseName, [record("100"), record("200")]);
    const first = new TagRepository(databaseName, { createId: () => "tag-first" });
    const second = new TagRepository(databaseName, { createId: () => "tag-second" });

    const assignments = await Promise.all([
      first.add("100", "Research"),
      second.add("200", "ＲＥＳＥＡＲＣＨ"),
    ]);

    expect(assignments[0].tag.id).toBe(assignments[1].tag.id);
    await expect(first.list()).resolves.toHaveLength(1);
  });

  it("rejects empty, oversized, and missing-bookmark assignments", async () => {
    const databaseName = `invalid-tag-${crypto.randomUUID()}`;
    await seed(databaseName, [record("100")]);
    const repository = new TagRepository(databaseName);

    await expect(repository.add("100", "  ")).rejects.toThrow(/empty/i);
    await expect(repository.add("100", "x".repeat(51))).rejects.toThrow(/50/);
    await expect(repository.add("missing", "Research")).rejects.toThrow(/not found/i);
    await expect(repository.remove("missing", "tag-1")).rejects.toThrow(/not found/i);
  });
});
