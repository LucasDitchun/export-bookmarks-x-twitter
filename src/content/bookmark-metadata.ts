import type { BookmarkMetadataReadModel, FolderRecord } from "../domain/types";
import type {
  FolderListResult,
  RuntimeResponse,
  TagListResult,
  UiRequest,
} from "../shared/protocol";
import type {
  BookmarkModalChoices,
  BookmarkModalFolderToken,
  BookmarkModalValues,
} from "../surfaces/bookmark-modal";

const MAX_NOTE_LENGTH = 20_000;
const MAX_TAG_LENGTH = 50;
const MAX_TAGS = 50;
const MAX_FOLDER_NAME_LENGTH = 100;
const MAX_FOLDER_DEPTH = 32;

type SendMetadataRequest = (request: UiRequest) => Promise<RuntimeResponse<unknown>>;

interface SaveBookmarkMetadataOptions {
  bookmark: BookmarkMetadataReadModel;
  values: BookmarkModalValues;
  send: SendMetadataRequest;
  signal?: AbortSignal;
}

interface ValidatedMetadata {
  note: string;
  tags: BookmarkModalValues["tags"];
  folder: BookmarkModalValues["folder"];
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
      values.tags.map(({ id, name: value }) => {
        const name = validateName(value, "tag");
        if (id !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
          throw new Error("Invalid tag ID.");
        }
        const tag = { id, name };
        return [
          id === null ? `name:${comparableName(name)}` : `id:${id}`,
          tag,
        ] as const;
      }),
    ).values(),
  ];
  if (tags.length > MAX_TAGS)
    throw new Error(`A bookmark can have at most ${MAX_TAGS} tags.`);

  if (
    values.folder?.id !== null &&
    values.folder?.id !== undefined &&
    !/^[A-Za-z0-9_-]{1,128}$/.test(values.folder.id)
  ) {
    throw new Error("Invalid folder ID.");
  }
  const rawFolderPath = values.folder?.path ?? [];
  if (rawFolderPath.length > MAX_FOLDER_DEPTH) {
    throw new Error(`A folder path can have at most ${MAX_FOLDER_DEPTH} levels.`);
  }
  const folder = values.folder && {
    id: values.folder.id,
    path: rawFolderPath.map((value) => validateName(value, "folder")),
  };
  return { note: values.description, tags, folder };
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

function folderTokenFor(
  folderId: string | null,
  folders: FolderRecord[],
): BookmarkModalFolderToken | null {
  if (!folderId) return null;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  const visited = new Set<string>();
  let current = byId.get(folderId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    names.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return names.length > 0 ? { id: folderId, path: names } : null;
}

export async function loadBookmarkMetadataValues(options: {
  bookmark: BookmarkMetadataReadModel;
  send: SendMetadataRequest;
  signal?: AbortSignal;
}): Promise<BookmarkModalValues> {
  return (await loadBookmarkMetadataDraft(options)).values;
}

export async function loadBookmarkMetadataDraft(options: {
  bookmark: BookmarkMetadataReadModel;
  send: SendMetadataRequest;
  signal?: AbortSignal;
}): Promise<{ values: BookmarkModalValues; choices: BookmarkModalChoices }> {
  const [tagData, folderData] = await Promise.all([
    sendChecked<unknown>(options.send, { type: "LIST_TAGS" }, options.signal),
    sendChecked<unknown>(options.send, { type: "LIST_FOLDERS" }, options.signal),
  ]);
  if (!isTagListResult(tagData) || !isFolderListResult(folderData)) {
    throw new Error("Invalid metadata response.");
  }
  const tagsById = new Map(tagData.tags.map((tag) => [tag.id, tag]));
  return {
    values: {
      description: options.bookmark.note,
      folder: folderTokenFor(options.bookmark.folderId, folderData.folders),
      tags: options.bookmark.tagIds
        .map((id) => tagsById.get(id))
        .filter((tag): tag is NonNullable<typeof tag> => tag !== undefined)
        .map((tag) => ({ id: tag.id, name: tag.name })),
    },
    choices: {
      folders: folderData.folders.flatMap((folder) => {
        const token = folderTokenFor(folder.id, folderData.folders);
        return token ? [{ ...token, id: folder.id }] : [];
      }),
      tags: tagData.tags.map((tag) => ({ id: tag.id, name: tag.name })),
    },
  };
}

export async function saveBookmarkMetadata(
  options: SaveBookmarkMetadataOptions,
): Promise<void> {
  const validated = validateValues(options.values);
  throwIfAborted(options.signal);
  await sendChecked(
    options.send,
    {
      type: "SAVE_BOOKMARK_METADATA",
      payload: {
        id: options.bookmark.id,
        note: validated.note,
        tags: validated.tags,
        folder: validated.folder,
      },
    },
    options.signal,
  );
}
