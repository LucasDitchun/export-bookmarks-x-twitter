import { describe, expect, it } from "vitest";

import type { BookmarkRecord, FolderRecord } from "../domain/types";
import { BookmarkDatabase, transactionDone } from "./bookmark-database";
import { BookmarkMetadataRepository } from "./bookmark-metadata-repository";
import { BookmarkRepository } from "./bookmark-repository";
import { FolderRepository } from "./folder-repository";
import { TagRepository } from "./tag-repository";

function bookmark(): BookmarkRecord {
  return {
    id: "123",
    text: "Post",
    url: "https://x.com/alice/status/123",
    author: { id: "alice", username: "alice", name: "Alice" },
    postCreatedAt: "2026-08-09T09:00:00.000Z",
    media: { images: [], videos: [] },
    note: "Old note",
    folderId: "folder-old",
    tagIds: [],
    firstSavedAt: "2026-08-09T09:01:00.000Z",
    lastSeenAt: "2026-08-09T09:01:00.000Z",
    archivedAt: null,
    metadataUpdatedAt: "2026-08-09T09:01:00.000Z",
    status: "current",
  };
}

async function seed(
  databaseName: string,
  record: BookmarkRecord,
  folders: readonly FolderRecord[],
): Promise<void> {
  const database = await new BookmarkDatabase(databaseName).open();
  const transaction = database.transaction(
    ["bookmarks", "folders", "bookmarkFolders"],
    "readwrite",
  );
  transaction.objectStore("bookmarks").put(record);
  for (const folder of folders) transaction.objectStore("folders").put(folder);
  transaction.objectStore("bookmarkFolders").put({
    bookmarkId: record.id,
    folderId: record.folderId,
  });
  await transactionDone(transaction);
  database.close();
}

async function seedTags(
  databaseName: string,
  tags: readonly Record<string, unknown>[],
): Promise<void> {
  const database = await new BookmarkDatabase(databaseName).open();
  const transaction = database.transaction("tags", "readwrite");
  for (const tag of tags) transaction.objectStore("tags").put(tag);
  await transactionDone(transaction);
  database.close();
}

describe("BookmarkMetadataRepository", () => {
  it("keeps selected tags and folders by ID after a concurrent rename", async () => {
    const databaseName = `metadata-selected-id-${crypto.randomUUID()}`;
    const original = bookmark();
    await seed(databaseName, original, [
      { id: "folder-old", name: "Old", parentId: null },
      { id: "folder-selected", name: "Research", parentId: null },
    ]);
    await seedTags(databaseName, [
      { id: "tag-selected", name: "Research", normalizedName: "research" },
    ]);
    await new TagRepository(databaseName).rename("tag-selected", "References");
    await new FolderRepository(databaseName).rename("folder-selected", "References");

    await expect(
      new BookmarkMetadataRepository(databaseName).save({
        id: "123",
        note: "Keep the selected entities",
        tags: [{ id: "tag-selected", name: "Research" }],
        folder: { id: "folder-selected", path: ["Research"] },
      }),
    ).resolves.toMatchObject({
      tagIds: ["tag-selected"],
      folderId: "folder-selected",
    });
    await expect(new TagRepository(databaseName).list()).resolves.toEqual([
      { id: "tag-selected", name: "References", normalizedName: "references" },
    ]);
    await expect(new FolderRepository(databaseName).list()).resolves.toContainEqual({
      id: "folder-selected",
      name: "References",
      parentId: null,
    });
  });

  it("creates child segments below a renamed folder by its canonical ID", async () => {
    const databaseName = `metadata-folder-base-${crypto.randomUUID()}`;
    await seed(databaseName, bookmark(), [
      { id: "folder-old", name: "Old", parentId: null },
      { id: "folder-selected", name: "Research", parentId: null },
    ]);
    await new FolderRepository(databaseName).rename("folder-selected", "References");
    const repository = new BookmarkMetadataRepository(databaseName, {
      createId: () => "folder-child",
    });

    await expect(
      repository.save({
        id: "123",
        note: "Use the canonical parent",
        tags: [],
        folder: {
          id: "folder-selected",
          path: ["Research", "Deep learning"],
          newSegments: ["Deep learning"],
        },
      }),
    ).resolves.toMatchObject({ folderId: "folder-child" });
    await expect(new FolderRepository(databaseName).list()).resolves.toContainEqual({
      id: "folder-child",
      name: "Deep learning",
      parentId: "folder-selected",
    });
    await expect(new FolderRepository(databaseName).list()).resolves.not.toContainEqual(
      expect.objectContaining({ name: "Research" }),
    );
  });

  it("rejects a concurrently deleted selected tag without recreating it", async () => {
    const databaseName = `metadata-deleted-tag-${crypto.randomUUID()}`;
    const original = { ...bookmark(), tagIds: ["tag-selected"] };
    await seed(databaseName, original, [
      { id: "folder-old", name: "Old", parentId: null },
    ]);
    await seedTags(databaseName, [
      { id: "tag-selected", name: "Research", normalizedName: "research" },
    ]);
    await new TagRepository(databaseName).delete("tag-selected");

    await expect(
      new BookmarkMetadataRepository(databaseName).save({
        id: "123",
        note: "Must roll back",
        tags: [{ id: "tag-selected", name: "Research" }],
        folder: null,
      }),
    ).rejects.toThrow("no longer available");
    await expect(new BookmarkRepository(databaseName).get("123")).resolves.toEqual(
      original,
    );
    await expect(new TagRepository(databaseName).list()).resolves.toEqual([]);
    await expect(new TagRepository(databaseName).listDeleted()).resolves.toEqual([
      expect.objectContaining({ id: "tag-selected" }),
    ]);
  });

  it("rejects a concurrently deleted selected folder without recreating it", async () => {
    const databaseName = `metadata-deleted-folder-${crypto.randomUUID()}`;
    const original = { ...bookmark(), folderId: "folder-selected" };
    await seed(databaseName, original, [
      { id: "folder-selected", name: "Research", parentId: null },
    ]);
    await new FolderRepository(databaseName).delete("folder-selected");

    await expect(
      new BookmarkMetadataRepository(databaseName).save({
        id: "123",
        note: "Must roll back",
        tags: [],
        folder: {
          id: "folder-selected",
          path: ["Research", "Child"],
          newSegments: ["Child"],
        },
      }),
    ).rejects.toThrow("no longer available");
    await expect(new BookmarkRepository(databaseName).get("123")).resolves.toEqual(
      original,
    );
    await expect(new FolderRepository(databaseName).list()).resolves.toEqual([]);
    await expect(new FolderRepository(databaseName).listDeleted()).resolves.toEqual([
      expect.objectContaining({ id: "folder-selected" }),
    ]);
  });

  it("replaces note, tags, and folder hierarchy in one save", async () => {
    const databaseName = `metadata-save-${crypto.randomUUID()}`;
    const original = bookmark();
    await seed(databaseName, original, [
      { id: "folder-old", name: "Old", parentId: null },
      { id: "folder-topics", name: "Topics", parentId: null },
    ]);
    const identifiers = ["tag-research", "folder-ai"];
    const repository = new BookmarkMetadataRepository(databaseName, {
      createId: () => identifiers.shift() ?? "unexpected",
      now: () => new Date("2026-08-13T05:30:00.000Z"),
    });

    await expect(
      repository.save({
        id: "123",
        note: "Why this matters",
        tags: [{ id: null, name: " Research " }],
        folder: { id: null, path: ["Topics", "AI"] },
      }),
    ).resolves.toMatchObject({
      id: "123",
      note: "Why this matters",
      tagIds: ["tag-research"],
      folderId: "folder-ai",
      metadataUpdatedAt: "2026-08-13T05:30:00.000Z",
    });
    await expect(new TagRepository(databaseName).list()).resolves.toEqual([
      { id: "tag-research", name: "Research", normalizedName: "research" },
    ]);
    await expect(new FolderRepository(databaseName).list()).resolves.toEqual([
      { id: "folder-old", name: "Old", parentId: null },
      { id: "folder-topics", name: "Topics", parentId: null },
      { id: "folder-ai", name: "AI", parentId: "folder-topics" },
    ]);
  });

  it("rolls back note, tag, folder, and membership changes after a late failure", async () => {
    const databaseName = `metadata-rollback-${crypto.randomUUID()}`;
    const original = bookmark();
    await seed(databaseName, original, [
      { id: "folder-old", name: "Old", parentId: null },
      { id: "folder-collision", name: "Existing", parentId: null },
    ]);
    const identifiers = ["tag-new", "folder-collision"];
    const repository = new BookmarkMetadataRepository(databaseName, {
      createId: () => identifiers.shift() ?? "unexpected",
      now: () => new Date("2026-08-13T05:30:00.000Z"),
    });

    await expect(
      repository.save({
        id: "123",
        note: "New note",
        tags: [{ id: null, name: "New tag" }],
        folder: { id: null, path: ["New folder"] },
      }),
    ).rejects.toThrow();

    await expect(new BookmarkRepository(databaseName).get("123")).resolves.toEqual(
      original,
    );
    await expect(new TagRepository(databaseName).list()).resolves.toEqual([]);
    await expect(new FolderRepository(databaseName).list()).resolves.toEqual([
      { id: "folder-collision", name: "Existing", parentId: null },
      { id: "folder-old", name: "Old", parentId: null },
    ]);

    const database = await new BookmarkDatabase(databaseName).open();
    const transaction = database.transaction("bookmarkFolders", "readonly");
    const memberships = await new Promise<unknown[]>((resolve, reject) => {
      const request = transaction.objectStore("bookmarkFolders").getAll();
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener(
        "error",
        () => reject(request.error ?? new Error("Membership query failed.")),
        { once: true },
      );
    });
    await transactionDone(transaction);
    database.close();
    expect(memberships).toEqual([{ bookmarkId: "123", folderId: "folder-old" }]);
  });

  it("does not revive soft-deleted tags or folders while replacing metadata", async () => {
    const databaseName = `metadata-trash-${crypto.randomUUID()}`;
    const original = bookmark();
    await seed(databaseName, original, [
      { id: "folder-old", name: "Old", parentId: null },
      {
        id: "folder-deleted",
        name: "Research",
        parentId: null,
        deletedAt: "2026-08-12T00:00:00.000Z",
      },
    ]);
    await seedTags(databaseName, [
      {
        id: "tag-deleted",
        name: "Research",
        normalizedName: "research",
        deletedAt: "2026-08-12T00:00:00.000Z",
      },
    ]);
    const identifiers = ["tag-active", "folder-active"];
    const repository = new BookmarkMetadataRepository(databaseName, {
      createId: () => identifiers.shift() ?? "unexpected",
    });

    await expect(
      repository.save({
        id: "123",
        note: "Updated",
        tags: [{ id: null, name: "Research" }],
        folder: { id: null, path: ["Research"] },
        organizationChanges: { tags: true, folder: true },
      }),
    ).resolves.toMatchObject({
      tagIds: ["tag-active"],
      folderId: "folder-active",
    });
    await expect(new TagRepository(databaseName).listDeleted()).resolves.toEqual([
      expect.objectContaining({ id: "tag-deleted" }),
    ]);
    await expect(new FolderRepository(databaseName).listDeleted()).resolves.toEqual([
      expect.objectContaining({ id: "folder-deleted" }),
    ]);
  });

  it("preserves tombstoned organization links during a note-only save", async () => {
    const databaseName = `metadata-note-only-${crypto.randomUUID()}`;
    const original = { ...bookmark(), tagIds: ["tag-hidden"] };
    await seed(databaseName, original, [
      { id: "folder-old", name: "Old", parentId: null },
    ]);
    await seedTags(databaseName, [
      { id: "tag-hidden", name: "Hidden", normalizedName: "hidden" },
    ]);
    const folders = new FolderRepository(databaseName);
    const tags = new TagRepository(databaseName);
    await folders.delete("folder-old");
    await tags.delete("tag-hidden");

    await expect(
      new BookmarkMetadataRepository(databaseName).save({
        id: "123",
        note: "Updated while organizations are in the trash",
        tags: [],
        folder: null,
        organizationChanges: { tags: false, folder: false },
      }),
    ).resolves.toMatchObject({
      note: "Updated while organizations are in the trash",
      tagIds: ["tag-hidden"],
      folderId: "folder-old",
    });

    await tags.restore("tag-hidden");
    await folders.restore("folder-old");
    await expect(
      new BookmarkRepository(databaseName).get("123"),
    ).resolves.toMatchObject({
      tagIds: ["tag-hidden"],
      folderId: "folder-old",
    });
  });

  it("replaces active tag links while preserving tombstoned links", async () => {
    const databaseName = `metadata-edit-visible-tags-${crypto.randomUUID()}`;
    const original = {
      ...bookmark(),
      tagIds: ["tag-active", "tag-hidden"],
    };
    await seed(databaseName, original, [
      { id: "folder-old", name: "Old", parentId: null },
    ]);
    await seedTags(databaseName, [
      { id: "tag-active", name: "Active", normalizedName: "active" },
      { id: "tag-hidden", name: "Hidden", normalizedName: "hidden" },
    ]);
    const tags = new TagRepository(databaseName);
    await tags.delete("tag-hidden");

    await expect(
      new BookmarkMetadataRepository(databaseName, {
        createId: () => "tag-new",
      }).save({
        id: "123",
        note: "Replace the visible tag",
        tags: [{ id: null, name: "New" }],
        folder: null,
        organizationChanges: { tags: true, folder: true },
      }),
    ).resolves.toMatchObject({
      tagIds: ["tag-new", "tag-hidden"],
    });

    await tags.restore("tag-hidden");
    await expect(
      new BookmarkRepository(databaseName).get("123"),
    ).resolves.toMatchObject({
      tagIds: ["tag-new", "tag-hidden"],
    });
  });
});
