import type { UiRequest } from "../shared/protocol";

type OrganizationRequest = Extract<
  UiRequest,
  | { type: "LIST_TAGS" }
  | { type: "LIST_ORGANIZATION_TRASH" }
  | { type: "ADD_BOOKMARK_TAG" }
  | { type: "REMOVE_BOOKMARK_TAG" }
  | { type: "RENAME_TAG" }
  | { type: "DELETE_TAG" }
  | { type: "RESTORE_TAG" }
  | { type: "LIST_FOLDERS" }
  | { type: "CREATE_FOLDER" }
  | { type: "RENAME_FOLDER" }
  | { type: "DELETE_FOLDER" }
  | { type: "RESTORE_FOLDER" }
  | { type: "ASSIGN_BOOKMARK_FOLDER" }
>;

export interface OrganizationRouterDependencies {
  tags: {
    list: () => Promise<unknown>;
    listDeleted: () => Promise<unknown>;
    usage?: () => Promise<Record<string, number>>;
    add: (bookmarkId: string, name: string) => Promise<unknown>;
    remove: (bookmarkId: string, tagId: string) => Promise<unknown>;
    rename: (id: string, name: string) => Promise<unknown>;
    delete: (id: string) => Promise<unknown>;
    restore: (id: string) => Promise<unknown>;
  };
  folders: {
    list: () => Promise<unknown>;
    listDeleted: () => Promise<unknown>;
    usage?: () => Promise<Record<string, number>>;
    create: (input: { name: string; parentId: string | null }) => Promise<unknown>;
    rename: (id: string, name: string) => Promise<unknown>;
    delete: (id: string) => Promise<unknown>;
    restore: (id: string) => Promise<unknown>;
    assignBookmark: (bookmarkId: string, folderId: string | null) => Promise<unknown>;
  };
  invalidateSearch: () => void;
  invalidateDecorationOrganization: () => void;
}

export function isOrganizationRequest(
  request: UiRequest,
): request is OrganizationRequest {
  switch (request.type) {
    case "LIST_TAGS":
    case "LIST_ORGANIZATION_TRASH":
    case "ADD_BOOKMARK_TAG":
    case "REMOVE_BOOKMARK_TAG":
    case "RENAME_TAG":
    case "DELETE_TAG":
    case "RESTORE_TAG":
    case "LIST_FOLDERS":
    case "CREATE_FOLDER":
    case "RENAME_FOLDER":
    case "DELETE_FOLDER":
    case "RESTORE_FOLDER":
    case "ASSIGN_BOOKMARK_FOLDER":
      return true;
    default:
      return false;
  }
}

export class OrganizationRouter {
  constructor(private readonly dependencies: OrganizationRouterDependencies) {}

  async handle(request: OrganizationRequest): Promise<unknown> {
    switch (request.type) {
      case "LIST_TAGS": {
        const [tags, usage] = await Promise.all([
          this.dependencies.tags.list(),
          this.dependencies.tags.usage?.() ?? Promise.resolve({}),
        ]);
        return { tags, usage };
      }
      case "LIST_ORGANIZATION_TRASH": {
        const [tags, folders] = await Promise.all([
          this.dependencies.tags.listDeleted(),
          this.dependencies.folders.listDeleted(),
        ]);
        return { tags, folders };
      }
      case "ADD_BOOKMARK_TAG": {
        const result = await this.dependencies.tags.add(
          request.payload.id,
          request.payload.name,
        );
        this.dependencies.invalidateDecorationOrganization();
        this.dependencies.invalidateSearch();
        return result;
      }
      case "REMOVE_BOOKMARK_TAG": {
        const bookmark = await this.dependencies.tags.remove(
          request.payload.id,
          request.payload.tagId,
        );
        this.dependencies.invalidateSearch();
        return { bookmark };
      }
      case "RENAME_TAG": {
        const tag = await this.dependencies.tags.rename(
          request.payload.id,
          request.payload.name,
        );
        this.dependencies.invalidateDecorationOrganization();
        this.dependencies.invalidateSearch();
        return { tag };
      }
      case "DELETE_TAG": {
        const result = await this.dependencies.tags.delete(request.payload.id);
        this.dependencies.invalidateDecorationOrganization();
        this.dependencies.invalidateSearch();
        return result;
      }
      case "RESTORE_TAG": {
        const tag = await this.dependencies.tags.restore(request.payload.id);
        this.dependencies.invalidateDecorationOrganization();
        this.dependencies.invalidateSearch();
        return { tag };
      }
      case "LIST_FOLDERS": {
        const [folders, usage] = await Promise.all([
          this.dependencies.folders.list(),
          this.dependencies.folders.usage?.() ?? Promise.resolve({}),
        ]);
        return { folders, usage };
      }
      case "CREATE_FOLDER": {
        const folder = await this.dependencies.folders.create(request.payload);
        this.dependencies.invalidateDecorationOrganization();
        this.dependencies.invalidateSearch();
        return { folder };
      }
      case "RENAME_FOLDER": {
        const folder = await this.dependencies.folders.rename(
          request.payload.id,
          request.payload.name,
        );
        this.dependencies.invalidateDecorationOrganization();
        this.dependencies.invalidateSearch();
        return { folder };
      }
      case "DELETE_FOLDER": {
        const result = await this.dependencies.folders.delete(request.payload.id);
        this.dependencies.invalidateDecorationOrganization();
        this.dependencies.invalidateSearch();
        return result;
      }
      case "RESTORE_FOLDER": {
        const result = await this.dependencies.folders.restore(request.payload.id);
        this.dependencies.invalidateDecorationOrganization();
        this.dependencies.invalidateSearch();
        return result;
      }
      case "ASSIGN_BOOKMARK_FOLDER": {
        const bookmark = await this.dependencies.folders.assignBookmark(
          request.payload.bookmarkId,
          request.payload.folderId,
        );
        this.dependencies.invalidateSearch();
        return { bookmark };
      }
    }
  }
}
