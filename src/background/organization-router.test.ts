import { describe, expect, it, vi } from "vitest";

import {
  isOrganizationRequest,
  OrganizationRouter,
  type OrganizationRouterDependencies,
} from "./organization-router";

function dependencies(): OrganizationRouterDependencies {
  return {
    tags: {
      list: vi.fn(() => Promise.resolve([{ id: "tag-a" }])),
      listDeleted: vi.fn(() => Promise.resolve([{ id: "tag-deleted" }])),
      usage: vi.fn(() => Promise.resolve({ "tag-a": 2 })),
      add: vi.fn(() => Promise.resolve({ tag: { id: "tag-a" } })),
      remove: vi.fn(() => Promise.resolve({ id: "100", tagIds: [] })),
      rename: vi.fn(() => Promise.resolve({ id: "tag-a", name: "New" })),
      delete: vi.fn(() => Promise.resolve({ deletedTagId: "tag-a" })),
      restore: vi.fn(() => Promise.resolve({ id: "tag-a" })),
    },
    folders: {
      list: vi.fn(() => Promise.resolve([{ id: "folder-a" }])),
      listDeleted: vi.fn(() => Promise.resolve([{ id: "folder-deleted" }])),
      usage: vi.fn(() => Promise.resolve({ "folder-a": 3 })),
      create: vi.fn(() => Promise.resolve({ id: "folder-a" })),
      rename: vi.fn(() => Promise.resolve({ id: "folder-a", name: "New" })),
      delete: vi.fn(() => Promise.resolve({ deletedFolderIds: ["folder-a"] })),
      restore: vi.fn(() => Promise.resolve({ restoredFolderIds: ["folder-a"] })),
      assignBookmark: vi.fn(() => Promise.resolve({ id: "100", folderId: null })),
    },
    invalidateSearch: vi.fn(),
    invalidateDecorationOrganization: vi.fn(),
  };
}

describe("OrganizationRouter", () => {
  it("recognizes only organization requests", () => {
    expect(isOrganizationRequest({ type: "LIST_TAGS" })).toBe(true);
    expect(isOrganizationRequest({ type: "GET_STATUS" })).toBe(false);
  });

  it("combines tags with usage without invalidating the search index", async () => {
    const deps = dependencies();
    const router = new OrganizationRouter(deps);

    await expect(router.handle({ type: "LIST_TAGS" })).resolves.toEqual({
      tags: [{ id: "tag-a" }],
      usage: { "tag-a": 2 },
    });
    expect(deps.invalidateSearch).not.toHaveBeenCalled();
    expect(deps.invalidateDecorationOrganization).not.toHaveBeenCalled();
  });

  it("preserves mutation response shapes and invalidates search", async () => {
    const deps = dependencies();
    const router = new OrganizationRouter(deps);

    await expect(
      router.handle({
        type: "ASSIGN_BOOKMARK_FOLDER",
        payload: { bookmarkId: "100", folderId: null },
      }),
    ).resolves.toEqual({ bookmark: { id: "100", folderId: null } });
    expect(deps.folders.assignBookmark).toHaveBeenCalledWith("100", null);
    expect(deps.invalidateSearch).toHaveBeenCalledOnce();
    expect(deps.invalidateDecorationOrganization).not.toHaveBeenCalled();
  });

  it("does not invalidate search when a mutation fails", async () => {
    const deps = dependencies();
    vi.mocked(deps.tags.delete).mockRejectedValue(new Error("delete failed"));
    const router = new OrganizationRouter(deps);

    await expect(
      router.handle({ type: "DELETE_TAG", payload: { id: "tag-a" } }),
    ).rejects.toThrow("delete failed");
    expect(deps.invalidateSearch).not.toHaveBeenCalled();
    expect(deps.invalidateDecorationOrganization).not.toHaveBeenCalled();
  });

  it("invalidates cached organization definitions after a successful rename", async () => {
    const deps = dependencies();
    const router = new OrganizationRouter(deps);

    await router.handle({
      type: "RENAME_TAG",
      payload: { id: "tag-a", name: "New" },
    });

    expect(deps.invalidateDecorationOrganization).toHaveBeenCalledOnce();
    expect(deps.invalidateSearch).toHaveBeenCalledOnce();
  });
});
