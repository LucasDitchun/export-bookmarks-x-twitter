import type { FolderRecord } from "./types";

function compareFolders(
  left: FolderRecord,
  right: FolderRecord,
  foldersById: ReadonlyMap<string, FolderRecord>,
): number {
  const path = (folder: FolderRecord): string => {
    const names: string[] = [];
    const visited = new Set<string>();
    let current: FolderRecord | undefined = folder;
    while (current !== undefined && !visited.has(current.id)) {
      visited.add(current.id);
      names.unshift(current.name);
      current =
        current.parentId === null ? undefined : foldersById.get(current.parentId);
    }
    return names.join("\u0000");
  };
  return path(left).localeCompare(path(right), undefined, { sensitivity: "base" });
}

export function sortFolders(folders: readonly FolderRecord[]): FolderRecord[] {
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  return [...folders].sort((left, right) => compareFolders(left, right, foldersById));
}

export function folderBreadcrumb(
  folderId: string | null,
  folders: readonly FolderRecord[],
): FolderRecord[] {
  if (folderId === null) return [];
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));
  const breadcrumb: FolderRecord[] = [];
  const visited = new Set<string>();
  let current = foldersById.get(folderId);
  while (current !== undefined && !visited.has(current.id)) {
    visited.add(current.id);
    breadcrumb.unshift(current);
    current = current.parentId === null ? undefined : foldersById.get(current.parentId);
  }
  return breadcrumb;
}
