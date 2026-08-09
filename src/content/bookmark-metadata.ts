import type { BookmarkRecord, BookmarkTag, FolderRecord } from "../domain/types";
import type {
  FolderDetailResult,
  FolderListResult,
  RuntimeResponse,
  TagListResult,
  UiRequest,
} from "../shared/protocol";
import type { BookmarkModalValues } from "../surfaces/bookmark-modal";

const MAX_NOTE_LENGTH = 20_000;
const MAX_TAG_LENGTH = 50;
const MAX_TAGS = 50;
const MAX_FOLDER_NAME_LENGTH = 100;
const MAX_FOLDER_DEPTH = 32;

type SendMetadataRequest = (request: UiRequest) => Promise<RuntimeResponse<unknown>>;

interface SaveBookmarkMetadataOptions {
  bookmark: BookmarkRecord;
  values: BookmarkModalValues;
  send: SendMetadataRequest;
  signal?: AbortSignal;
}

interface ValidatedMetadata {
  note: string;
  tags: string[];
  folderPath: string[];
}

function normalizeName(value: string): string {
  return value.trim().normalize("NFKC");
}

function comparableName(value: string): string {
  return normalizeName(value).toLocaleLowerCase("en-US");
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function validateName(value: string, kind: "tag" | "folder"): string {
  const normalized = normalizeName(value);
  const maximum = kind === "tag" ? MAX_TAG_LENGTH : MAX_FOLDER_NAME_LENGTH;
  if (!normalized || normalized.length > maximum || hasControlCharacters(normalized)) {
    throw new Error(`Invalid ${kind} name.`);
  }
  return normalized;
}

function validateValues(values: BookmarkModalValues): ValidatedMetadata {
  if (values.description.length > MAX_NOTE_LENGTH) {
    throw new Error("The note must contain at most 20,000 characters.");
  }
  const tags = [
    ...new Map(
      values.tags
        .split(",")
        .filter((value) => normalizeName(value).length > 0)
        .map((value) => {
          const name = validateName(value, "tag");
          return [comparableName(name), name] as const;
        }),
    ).values(),
  ];
  if (tags.length > MAX_TAGS)
    throw new Error(`A bookmark can have at most ${MAX_TAGS} tags.`);

  const rawFolderPath = values.folder
    .split("/")
    .filter((value) => normalizeName(value).length > 0);
  if (rawFolderPath.length > MAX_FOLDER_DEPTH) {
    throw new Error(`A folder path can have at most ${MAX_FOLDER_DEPTH} levels.`);
  }
  const folderPath = rawFolderPath.map((value) => validateName(value, "folder"));
  return { note: values.description, tags, folderPath };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new DOMException("The operation was aborted.", "AbortError");
}

async function sendChecked<T>(
  send: SendMetadataRequest,
  request: UiRequest,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  const response = await send(request);
  throwIfAborted(signal);
  if (!response.ok) throw new Error(response.error.message || response.error.code);
  return response.data as T;
}

function isTagListResult(value: unknown): value is TagListResult {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as Partial<TagListResult>).tags)
  );
}

function isFolderListResult(value: unknown): value is FolderListResult {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as Partial<FolderListResult>).folders)
  );
}

function folderPathFor(folderId: string | null, folders: FolderRecord[]): string {
  if (!folderId) return "";
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  const visited = new Set<string>();
  let current = byId.get(folderId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.join(" / ");
}

export async function loadBookmarkMetadataValues(options: {
  bookmark: BookmarkRecord;
  send: SendMetadataRequest;
  signal?: AbortSignal;
}): Promise<BookmarkModalValues> {
  const [tagData, folderData] = await Promise.all([
    sendChecked<unknown>(options.send, { type: "LIST_TAGS" }, options.signal),
    sendChecked<unknown>(options.send, { type: "LIST_FOLDERS" }, options.signal),
  ]);
  if (!isTagListResult(tagData) || !isFolderListResult(folderData)) {
    throw new Error("Invalid metadata response.");
  }
  const tagsById = new Map(tagData.tags.map((tag) => [tag.id, tag]));
  return {
    description: options.bookmark.note,
    folder: folderPathFor(options.bookmark.folderId, folderData.folders),
    tags: options.bookmark.tagIds
      .map((id) => tagsById.get(id)?.name)
      .filter((name): name is string => typeof name === "string")
      .join(", "),
  };
}

async function reconcileTags(
  options: SaveBookmarkMetadataOptions,
  names: string[],
): Promise<void> {
  const data = await sendChecked<unknown>(
    options.send,
    { type: "LIST_TAGS" },
    options.signal,
  );
  if (!isTagListResult(data)) throw new Error("Invalid tag response.");
  const byId = new Map(data.tags.map((tag) => [tag.id, tag]));
  const assigned = options.bookmark.tagIds
    .map((id) => byId.get(id))
    .filter((tag): tag is BookmarkTag => tag !== undefined);
  const desired = new Map(names.map((name) => [comparableName(name), name]));

  for (const tag of assigned) {
    if (!desired.has(comparableName(tag.normalizedName || tag.name))) {
      await sendChecked(
        options.send,
        {
          type: "REMOVE_BOOKMARK_TAG",
          payload: { id: options.bookmark.id, tagId: tag.id },
        },
        options.signal,
      );
    }
  }
  const assignedNames = new Set(
    assigned.map((tag) => comparableName(tag.normalizedName || tag.name)),
  );
  for (const [normalized, name] of desired) {
    if (!assignedNames.has(normalized)) {
      await sendChecked(
        options.send,
        { type: "ADD_BOOKMARK_TAG", payload: { id: options.bookmark.id, name } },
        options.signal,
      );
    }
  }
}

async function resolveFolder(
  options: SaveBookmarkMetadataOptions,
  path: string[],
): Promise<string | null> {
  if (path.length === 0) return null;
  const data = await sendChecked<unknown>(
    options.send,
    { type: "LIST_FOLDERS" },
    options.signal,
  );
  if (!isFolderListResult(data)) throw new Error("Invalid folder response.");
  const folders = [...data.folders];
  let parentId: string | null = null;
  for (const name of path) {
    let folder = folders.find(
      (candidate) =>
        candidate.parentId === parentId &&
        comparableName(candidate.name) === comparableName(name),
    );
    if (!folder) {
      const created: FolderDetailResult = await sendChecked<FolderDetailResult>(
        options.send,
        { type: "CREATE_FOLDER", payload: { name, parentId } },
        options.signal,
      );
      if (!created?.folder) throw new Error("Invalid folder response.");
      const createdFolder: FolderRecord = created.folder;
      folder = createdFolder;
      folders.push(createdFolder);
    }
    parentId = folder.id;
  }
  return parentId;
}

export async function saveBookmarkMetadata(
  options: SaveBookmarkMetadataOptions,
): Promise<void> {
  const validated = validateValues(options.values);
  throwIfAborted(options.signal);
  await sendChecked(
    options.send,
    {
      type: "SAVE_BOOKMARK_NOTE",
      payload: { id: options.bookmark.id, note: validated.note },
    },
    options.signal,
  );
  await reconcileTags(options, validated.tags);
  const folderId = await resolveFolder(options, validated.folderPath);
  await sendChecked(
    options.send,
    {
      type: "ASSIGN_BOOKMARK_FOLDER",
      payload: { bookmarkId: options.bookmark.id, folderId },
    },
    options.signal,
  );
}
