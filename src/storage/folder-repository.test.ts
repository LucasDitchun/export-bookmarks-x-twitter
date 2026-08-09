import { describe, expect, it } from "vitest";

import type { BookmarkRecord, FolderRecord } from "../domain/types";
import { exportBookmarks } from "../domain/export-bookmarks";
import { ArchiveRepository } from "./archive-repository";
import { BookmarkDatabase, transactionDone } from "./bookmark-database";
import { BookmarkRepository } from "./bookmark-repository";
import { FolderRepository } from "./folder-repository";

function bookmark(overrides: Partial<BookmarkRecord> = {}): BookmarkRecord {
  return {
    id: "123",
    text: "A saved post",
    url: "https://x.com/person/status/123",
    author: { id: "person", username: "person", name: "Person" },
    postCreatedAt: "2026-01-01T00:00:00.000Z",
    media: { images: [], videos: [] },
    note: "Keep this note",
    folderId: null,
    tagIds: ["tag-1"],
    firstSavedAt: "2026-01-02T00:00:00.000Z",
    lastSeenAt: "2026-01-02T00:00:00.000Z",
    archivedAt: null,
    metadataUpdatedAt: "2026-01-02T00:00:00.000Z",
    status: "current",
    ...overrides,
  };
}

async function seed(
  databaseName: string,
  folders: readonly FolderRecord[],
  bookmarks: readonly BookmarkRecord[] = [],
): Promise<void> {
  const database = await new BookmarkDatabase(databaseName).open();
  const transaction = database.transaction(["folders", "bookmarks"], "readwrite");
  for (const folder of folders) transaction.objectStore("folders").put(folder);
  for (const record of bookmarks) transaction.objectStore("bookmarks").put(record);
  await transactionDone(transaction);
  database.close();
}

describe("FolderRepository", () => {
  it("creates root folders and subfolders with validated, trimmed names", async () => {
    const databaseName = `folders-create-${crypto.randomUUID()}`;
    const identifiers = ["folder-root", "folder-child"];
    const repository = new FolderRepository(databaseName, {
      createId: () => identifiers.shift() ?? "unexpected",
    });

    const root = await repository.create({ name: "  Research  ", parentId: null });
    const child = await repository.create({ name: "AI", parentId: root.id });

    expect(root).toEqual({ id: "folder-root", name: "Research", parentId: null });
    expect(child).toEqual({
      id: "folder-child",
      name: "AI",
      parentId: "folder-root",
    });
    await expect(repository.list()).resolves.toEqual([root, child]);
  });

  it("rejects invalid names, missing parents, and duplicate sibling names", async () => {
    const databaseName = `folders-validation-${crypto.randomUUID()}`;
    const repository = new FolderRepository(databaseName, {
      createId: () => crypto.randomUUID(),
    });
    const root = await repository.create({ name: "Research", parentId: null });

    await expect(repository.create({ name: "   ", parentId: null })).rejects.toThrow(
      /name/i,
    );
    await expect(
      repository.create({ name: "x".repeat(101), parentId: null }),
    ).rejects.toThrow(/100/);
    await expect(
      repository.create({ name: "Orphan", parentId: "missing" }),
    ).rejects.toThrow(/parent/i);
    await expect(
      repository.create({ name: " research ", parentId: null }),
    ).rejects.toThrow(/already exists/i);
    await expect(repository.rename(root.id, "\u0000unsafe")).rejects.toThrow(/name/i);
  });

  it("renames folders without changing their parent", async () => {
    const databaseName = `folders-rename-${crypto.randomUUID()}`;
    await seed(databaseName, [
      { id: "root", name: "Research", parentId: null },
      { id: "child", name: "AI", parentId: "root" },
    ]);
    const repository = new FolderRepository(databaseName);

    await expect(repository.rename("child", "  Machine learning ")).resolves.toEqual({
      id: "child",
      name: "Machine learning",
      parentId: "root",
    });
    await expect(repository.rename("missing", "Name")).rejects.toThrow(/not found/i);
  });

  it("assigns one folder and replaces every legacy membership atomically", async () => {
    const databaseName = `folders-assign-${crypto.randomUUID()}`;
    const original = bookmark({ folderId: "legacy-a" });
    await seed(
      databaseName,
      [
        { id: "legacy-a", name: "Legacy A", parentId: null },
        { id: "legacy-b", name: "Legacy B", parentId: null },
        { id: "target", name: "Target", parentId: null },
      ],
      [original],
    );
    const database = await new BookmarkDatabase(databaseName).open();
    const legacy = database.transaction("bookmarkFolders", "readwrite");
    legacy.objectStore("bookmarkFolders").put({
      bookmarkId: original.id,
      folderId: "legacy-a",
    });
    legacy.objectStore("bookmarkFolders").put({
      bookmarkId: original.id,
      folderId: "legacy-b",
    });
    await transactionDone(legacy);
    database.close();
    const repository = new FolderRepository(databaseName, {
      now: () => new Date("2026-08-09T06:00:00.000Z"),
    });

    const assigned = await repository.assignBookmark(original.id, "target");
    expect(assigned).toEqual({
      ...original,
      folderId: "target",
      metadataUpdatedAt: "2026-08-09T06:00:00.000Z",
    });

    const verification = await new BookmarkDatabase(databaseName).open();
    const read = verification.transaction("bookmarkFolders", "readonly");
    const memberships = await new Promise<unknown[]>((resolve, reject) => {
      const request = read.objectStore("bookmarkFolders").getAll();
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener(
        "error",
        () => reject(request.error ?? new Error("Membership query failed.")),
        { once: true },
      );
    });
    await transactionDone(read);
    expect(memberships).toEqual([{ bookmarkId: "123", folderId: "target" }]);
    verification.close();
  });

  it("recursively deletes a subtree and uncategorizes affected bookmarks only", async () => {
    const databaseName = `folders-delete-${crypto.randomUUID()}`;
    const affected = bookmark({ id: "123", folderId: "child" });
    const nested = bookmark({ id: "456", folderId: "grandchild" });
    const untouched = bookmark({ id: "789", folderId: "other" });
    await seed(
      databaseName,
      [
        { id: "root", name: "Root", parentId: null },
        { id: "child", name: "Child", parentId: "root" },
        { id: "grandchild", name: "Grandchild", parentId: "child" },
        { id: "other", name: "Other", parentId: null },
      ],
      [affected, nested, untouched],
    );
    const repository = new FolderRepository(databaseName, {
      now: () => new Date("2026-08-09T07:00:00.000Z"),
    });

    await expect(repository.delete("child")).resolves.toEqual({
      deletedFolderIds: ["child", "grandchild"],
      uncategorizedBookmarkCount: 2,
    });
    await expect(repository.list()).resolves.toEqual([
      { id: "other", name: "Other", parentId: null },
      { id: "root", name: "Root", parentId: null },
    ]);

    const database = await new BookmarkDatabase(databaseName).open();
    const read = database.transaction("bookmarks", "readonly");
    const stored = await new Promise<BookmarkRecord[]>((resolve, reject) => {
      const request = read.objectStore("bookmarks").getAll();
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener(
        "error",
        () => reject(request.error ?? new Error("Bookmark query failed.")),
        { once: true },
      );
    });
    await transactionDone(read);
    expect(stored).toEqual(
      expect.arrayContaining([
        {
          ...affected,
          folderId: null,
          metadataUpdatedAt: "2026-08-09T07:00:00.000Z",
        },
        {
          ...nested,
          folderId: null,
          metadataUpdatedAt: "2026-08-09T07:00:00.000Z",
        },
        untouched,
      ]),
    );
    database.close();
  });

  it("serializes concurrent note and folder writes without clobbering either field", async () => {
    const databaseName = `folders-concurrent-${crypto.randomUUID()}`;
    const original = bookmark();
    await seed(
      databaseName,
      [{ id: "research", name: "Research", parentId: null }],
      [original],
    );
    const notes = new BookmarkRepository(databaseName, {
      now: () => new Date("2026-08-09T08:00:00.000Z"),
    });
    const folders = new FolderRepository(databaseName, {
      now: () => new Date("2026-08-09T08:00:01.000Z"),
    });

    await Promise.all([
      notes.saveNote(original.id, "Updated concurrently"),
      folders.assignBookmark(original.id, "research"),
    ]);

    await expect(notes.get(original.id)).resolves.toMatchObject({
      note: "Updated concurrently",
      folderId: "research",
      tagIds: ["tag-1"],
    });

    const olderSave = notes.saveNote(original.id, "Older in-flight draft");
    const teardownSave = notes.saveNote(original.id, "Latest teardown draft");
    await Promise.all([olderSave, teardownSave]);
    await expect(notes.get(original.id)).resolves.toMatchObject({
      note: "Latest teardown draft",
      folderId: "research",
      tagIds: ["tag-1"],
    });
  });

  it("moves complete bookmarks into and out of Inbox and removes deleted paths from export", async () => {
    const databaseName = `folders-inbox-export-${crypto.randomUUID()}`;
    const original = bookmark({ folderId: null });
    await seed(
      databaseName,
      [
        { id: "research", name: "Research", parentId: null },
        { id: "ai", name: "AI", parentId: "research" },
      ],
      [original],
    );
    const folders = new FolderRepository(databaseName);
    const bookmarks = new BookmarkRepository(databaseName);
    const archive = new ArchiveRepository(databaseName);

    await expect(bookmarks.list({ view: "inbox", limit: 10 })).resolves.toMatchObject({
      items: [expect.objectContaining({ id: original.id })],
    });
    await folders.assignBookmark(original.id, "ai");
    await expect(bookmarks.list({ view: "inbox", limit: 10 })).resolves.toMatchObject({
      items: [],
    });
    await folders.delete("research");
    const hydrated = await archive.getAll();
    expect(hydrated[0]).toMatchObject({
      id: original.id,
      folderId: null,
      folders: [],
      note: "Keep this note",
      tagIds: ["tag-1"],
    });
    const exported = exportBookmarks(hydrated, { format: "full", locale: "en" });
    expect(exported).toContain("Folder: No folder");
    expect(exported).not.toContain("Research");
    expect(exported).not.toContain("AI");
  });
});
