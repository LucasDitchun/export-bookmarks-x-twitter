import type {
  BookmarkRecord,
  BookmarkTag,
  FolderRecord,
  SupportedLocale,
} from "./types";

export type BookmarkExportFormat = "txt" | "md";

export interface BookmarkExportFields {
  url: boolean;
  text: boolean;
  author: boolean;
  postDate: boolean;
  note: boolean;
  breadcrumb: boolean;
  tags: boolean;
  images: boolean;
  videos: boolean;
  firstSavedAt: boolean;
  lastSeenAt: boolean;
}

export interface BookmarkExportOptions {
  format: BookmarkExportFormat;
  locale: SupportedLocale;
  /** Null selects the whole folder tree. A folder id selects that subtree. */
  folderId: string | null;
  /** Empty selects every tag. Multiple ids use OR semantics. */
  tagIds: readonly string[];
  includeArchived: boolean;
  fields: BookmarkExportFields;
}

export interface ExportLibrarySnapshot {
  bookmarks: readonly BookmarkRecord[];
  folders: readonly FolderRecord[];
  tags: readonly BookmarkTag[];
}

interface ExportCopy {
  title: string;
  items(count: number): string;
  bookmark: string;
  url: string;
  author: string;
  postDate: string;
  note: string;
  folder: string;
  noFolder: string;
  tags: string;
  noTags: string;
  images: string;
  videos: string;
  firstSavedAt: string;
  lastSeenAt: string;
  text: string;
}

const UTF8_BOM = "\uFEFF";
const TXT_SEPARATOR = "────────────────────────────────────────";

const copy: Record<SupportedLocale, ExportCopy> = {
  en: {
    title: "BOOKMARK X ARCHIVE",
    items: (count) => `${count} ${count === 1 ? "item" : "items"}`,
    bookmark: "Bookmark",
    url: "URL",
    author: "Author",
    postDate: "Post date",
    note: "Note",
    folder: "Folder",
    noFolder: "No folder",
    tags: "Tags",
    noTags: "No tags",
    images: "Images",
    videos: "Videos",
    firstSavedAt: "First saved",
    lastSeenAt: "Last seen",
    text: "Text",
  },
  pt_BR: {
    title: "ARQUIVO BOOKMARK X",
    items: (count) => `${count} ${count === 1 ? "item" : "itens"}`,
    bookmark: "Bookmark",
    url: "URL",
    author: "Autor",
    postDate: "Data do post",
    note: "Nota",
    folder: "Pasta",
    noFolder: "Sem pasta",
    tags: "Tags",
    noTags: "Sem tags",
    images: "Imagens",
    videos: "Vídeos",
    firstSavedAt: "Primeiro salvamento",
    lastSeenAt: "Visto por último",
    text: "Texto",
  },
  ja: {
    title: "BOOKMARK X アーカイブ",
    items: (count) => `${count}件`,
    bookmark: "ブックマーク",
    url: "URL",
    author: "投稿者",
    postDate: "投稿日",
    note: "メモ",
    folder: "フォルダー",
    noFolder: "フォルダーなし",
    tags: "タグ",
    noTags: "タグなし",
    images: "画像",
    videos: "動画",
    firstSavedAt: "初回保存日時",
    lastSeenAt: "最終確認日時",
    text: "本文",
  },
  es: {
    title: "ARCHIVO BOOKMARK X",
    items: (count) => `${count} ${count === 1 ? "elemento" : "elementos"}`,
    bookmark: "Marcador",
    url: "URL",
    author: "Autor",
    postDate: "Fecha de publicación",
    note: "Nota",
    folder: "Carpeta",
    noFolder: "Sin carpeta",
    tags: "Etiquetas",
    noTags: "Sin etiquetas",
    images: "Imágenes",
    videos: "Vídeos",
    firstSavedAt: "Primer guardado",
    lastSeenAt: "Visto por última vez",
    text: "Texto",
  },
  zh_CN: {
    title: "BOOKMARK X 存档",
    items: (count) => `${count} 项`,
    bookmark: "书签",
    url: "网址",
    author: "作者",
    postDate: "发布日期",
    note: "笔记",
    folder: "文件夹",
    noFolder: "无文件夹",
    tags: "标签",
    noTags: "无标签",
    images: "图片",
    videos: "视频",
    firstSavedAt: "首次保存",
    lastSeenAt: "最后查看",
    text: "正文",
  },
  de: {
    title: "BOOKMARK-X-ARCHIV",
    items: (count) => `${count} ${count === 1 ? "Eintrag" : "Einträge"}`,
    bookmark: "Lesezeichen",
    url: "URL",
    author: "Autor",
    postDate: "Beitragsdatum",
    note: "Notiz",
    folder: "Ordner",
    noFolder: "Kein Ordner",
    tags: "Tags",
    noTags: "Keine Tags",
    images: "Bilder",
    videos: "Videos",
    firstSavedAt: "Erstmals gespeichert",
    lastSeenAt: "Zuletzt gesehen",
    text: "Text",
  },
  fr: {
    title: "ARCHIVE BOOKMARK X",
    items: (count) => `${count} ${count === 1 ? "élément" : "éléments"}`,
    bookmark: "Signet",
    url: "URL",
    author: "Auteur",
    postDate: "Date de publication",
    note: "Note",
    folder: "Dossier",
    noFolder: "Aucun dossier",
    tags: "Étiquettes",
    noTags: "Aucune étiquette",
    images: "Images",
    videos: "Vidéos",
    firstSavedAt: "Première sauvegarde",
    lastSeenAt: "Dernière consultation",
    text: "Texte",
  },
  it: {
    title: "ARCHIVIO BOOKMARK X",
    items: (count) => `${count} ${count === 1 ? "elemento" : "elementi"}`,
    bookmark: "Segnalibro",
    url: "URL",
    author: "Autore",
    postDate: "Data del post",
    note: "Nota",
    folder: "Cartella",
    noFolder: "Nessuna cartella",
    tags: "Tag",
    noTags: "Nessun tag",
    images: "Immagini",
    videos: "Video",
    firstSavedAt: "Primo salvataggio",
    lastSeenAt: "Ultima visualizzazione",
    text: "Testo",
  },
};

export class ExportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportValidationError";
  }
}

export function hasEnabledExportField(fields: BookmarkExportFields): boolean {
  return Object.values(fields).some(Boolean);
}

function normalizeText(text: string): string {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trimEnd();
}

function selectedFolderIds(
  folderId: string | null,
  folders: readonly FolderRecord[],
): Set<string> | null {
  if (folderId === null) return null;
  const selected = new Set([folderId]);
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    if (folder.parentId === null) continue;
    const ids = children.get(folder.parentId) ?? [];
    ids.push(folder.id);
    children.set(folder.parentId, ids);
  }
  const pending = [folderId];
  while (pending.length > 0) {
    const parentId = pending.pop()!;
    for (const childId of children.get(parentId) ?? []) {
      if (selected.has(childId)) continue;
      selected.add(childId);
      pending.push(childId);
    }
  }
  return selected;
}

function filteredBookmarks(
  snapshot: ExportLibrarySnapshot,
  options: BookmarkExportOptions,
): BookmarkRecord[] {
  const folderIds = selectedFolderIds(options.folderId, snapshot.folders);
  const tagIds = new Set(options.tagIds);
  const deduplicated = new Map<string, BookmarkRecord>();
  for (const bookmark of snapshot.bookmarks) {
    if (!options.includeArchived && bookmark.status === "archived") continue;
    if (
      folderIds !== null &&
      (bookmark.folderId === null || !folderIds.has(bookmark.folderId))
    ) {
      continue;
    }
    if (tagIds.size > 0 && !bookmark.tagIds.some((tagId) => tagIds.has(tagId))) {
      continue;
    }
    if (!deduplicated.has(bookmark.id)) deduplicated.set(bookmark.id, bookmark);
  }
  return [...deduplicated.values()].sort((left, right) => {
    const byDate = right.postCreatedAt.localeCompare(left.postCreatedAt);
    return byDate === 0 ? right.id.localeCompare(left.id) : byDate;
  });
}

interface RenderContext {
  folders: ReadonlyMap<string, FolderRecord>;
  tags: ReadonlyMap<string, BookmarkTag>;
}

function breadcrumb(
  folderId: string | null,
  folders: ReadonlyMap<string, FolderRecord>,
): string[] {
  if (folderId === null) return [];
  const path: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = folderId;
  while (currentId !== null && !visited.has(currentId)) {
    visited.add(currentId);
    const folder: FolderRecord | undefined = folders.get(currentId);
    if (folder === undefined) break;
    path.push(folder.name);
    currentId = folder.parentId;
  }
  return path.reverse();
}

function resolvedTags(
  tagIds: readonly string[],
  tags: ReadonlyMap<string, BookmarkTag>,
): BookmarkTag[] {
  return tagIds
    .map((id) => tags.get(id))
    .filter((tag): tag is BookmarkTag => tag !== undefined)
    .sort((left, right) =>
      left.normalizedName === right.normalizedName
        ? left.id.localeCompare(right.id)
        : left.normalizedName.localeCompare(right.normalizedName, "und"),
    );
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function appendTxtMultiline(lines: string[], label: string, value: string): void {
  lines.push(`${label}:`);
  lines.push(normalizeText(value));
}

function renderTxtBookmark(
  bookmark: BookmarkRecord,
  options: BookmarkExportOptions,
  labels: ExportCopy,
  context: RenderContext,
): string {
  const { fields } = options;
  const lines: string[] = [];
  if (fields.author) {
    lines.push(`@${bookmark.author.username} — ${bookmark.author.name}`);
  }
  if (fields.postDate) lines.push(`${labels.postDate}: ${bookmark.postCreatedAt}`);
  if (fields.breadcrumb) {
    const path = breadcrumb(bookmark.folderId, context.folders);
    lines.push(
      `${labels.folder}: ${path.length > 0 ? path.join(" › ") : labels.noFolder}`,
    );
  }
  if (fields.tags) {
    const tags = resolvedTags(bookmark.tagIds, context.tags);
    lines.push(
      `${labels.tags}: ${tags.length > 0 ? tags.map(({ name }) => name).join(", ") : labels.noTags}`,
    );
  }
  if (fields.firstSavedAt) {
    lines.push(`${labels.firstSavedAt}: ${bookmark.firstSavedAt}`);
  }
  if (fields.lastSeenAt) lines.push(`${labels.lastSeenAt}: ${bookmark.lastSeenAt}`);
  if (fields.url) lines.push(`${labels.url}: ${bookmark.url}`);
  if (fields.images) {
    const images = unique(bookmark.media.images);
    if (images.length > 0) lines.push(`${labels.images}:\n${images.join("\n")}`);
  }
  if (fields.videos) {
    const videos = unique(bookmark.media.videos.map(({ postUrl }) => postUrl));
    if (videos.length > 0) lines.push(`${labels.videos}:\n${videos.join("\n")}`);
  }
  if (fields.text) appendTxtMultiline(lines, labels.text, bookmark.text);
  if (fields.note) appendTxtMultiline(lines, labels.note, bookmark.note);
  return lines.join("\n");
}

function escapeMarkdown(value: string): string {
  return normalizeText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/([\\`*_[\]{}()#+\-.!|])/g, "\\$1");
}

function markdownLink(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      return escapeMarkdown(url);
    }
  } catch {
    return escapeMarkdown(url);
  }
  return `<${parsed.href}>`;
}

function markdownTextBlock(label: string, value: string): string[] {
  const escaped = escapeMarkdown(value);
  return [
    `### ${escapeMarkdown(label)}`,
    "",
    ...(escaped.length > 0
      ? escaped.split("\n").map((line) => (line.length > 0 ? `> ${line}` : ">"))
      : ["> —"]),
  ];
}

function renderMarkdownBookmark(
  bookmark: BookmarkRecord,
  index: number,
  options: BookmarkExportOptions,
  labels: ExportCopy,
  context: RenderContext,
): string {
  const { fields } = options;
  const lines = [`## ${index + 1}. ${escapeMarkdown(labels.bookmark)}`];
  if (fields.url)
    lines.push(`- **${escapeMarkdown(labels.url)}:** ${markdownLink(bookmark.url)}`);
  if (fields.author) {
    lines.push(
      `- **${escapeMarkdown(labels.author)}:** ${escapeMarkdown(`@${bookmark.author.username} — ${bookmark.author.name}`)}`,
    );
  }
  if (fields.postDate) {
    lines.push(
      `- **${escapeMarkdown(labels.postDate)}:** ${escapeMarkdown(bookmark.postCreatedAt)}`,
    );
  }
  if (fields.breadcrumb) {
    const path = breadcrumb(bookmark.folderId, context.folders);
    const label = path.length > 0 ? path.join(" › ") : labels.noFolder;
    lines.push(`- **${escapeMarkdown(labels.folder)}:** ${escapeMarkdown(label)}`);
  }
  if (fields.tags) {
    const tags = resolvedTags(bookmark.tagIds, context.tags);
    const label =
      tags.length > 0 ? tags.map(({ name }) => name).join(", ") : labels.noTags;
    lines.push(`- **${escapeMarkdown(labels.tags)}:** ${escapeMarkdown(label)}`);
  }
  if (fields.firstSavedAt) {
    lines.push(
      `- **${escapeMarkdown(labels.firstSavedAt)}:** ${escapeMarkdown(bookmark.firstSavedAt)}`,
    );
  }
  if (fields.lastSeenAt) {
    lines.push(
      `- **${escapeMarkdown(labels.lastSeenAt)}:** ${escapeMarkdown(bookmark.lastSeenAt)}`,
    );
  }
  if (fields.images) {
    for (const image of unique(bookmark.media.images)) {
      lines.push(`- **${escapeMarkdown(labels.images)}:** ${markdownLink(image)}`);
    }
  }
  if (fields.videos) {
    for (const video of unique(bookmark.media.videos.map(({ postUrl }) => postUrl))) {
      lines.push(`- **${escapeMarkdown(labels.videos)}:** ${markdownLink(video)}`);
    }
  }
  if (fields.text) lines.push("", ...markdownTextBlock(labels.text, bookmark.text));
  if (fields.note) lines.push("", ...markdownTextBlock(labels.note, bookmark.note));
  return lines.join("\n");
}

export function buildBookmarkExport(
  snapshot: ExportLibrarySnapshot,
  options: BookmarkExportOptions,
): string {
  if (!hasEnabledExportField(options.fields)) {
    throw new ExportValidationError("Select at least one field to export.");
  }
  const labels = copy[options.locale];
  const bookmarks = filteredBookmarks(snapshot, options);
  const context: RenderContext = {
    folders: new Map(snapshot.folders.map((folder) => [folder.id, folder])),
    tags: new Map(snapshot.tags.map((tag) => [tag.id, tag])),
  };
  if (options.format === "md") {
    const body = bookmarks
      .map((bookmark, index) =>
        renderMarkdownBookmark(bookmark, index, options, labels, context),
      )
      .join("\n\n---\n\n");
    return `${UTF8_BOM}# ${labels.title}\n\n${labels.items(bookmarks.length)}${body.length > 0 ? `\n\n${body}` : ""}\n`;
  }
  const body = bookmarks
    .map((bookmark) => renderTxtBookmark(bookmark, options, labels, context))
    .join(`\n\n${TXT_SEPARATOR}\n\n`);
  return `${UTF8_BOM}${labels.title}\n${labels.items(bookmarks.length)}${body.length > 0 ? `\n\n${body}` : ""}\n`;
}
