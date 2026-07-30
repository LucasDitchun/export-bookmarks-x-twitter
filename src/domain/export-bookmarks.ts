import type { BookmarkRecord, ExportOptions } from "./types";

const UTF8_BOM = "\uFEFF";

const copy = {
  en: {
    title: "BOOKMARK X ARCHIVE",
    items: (count: number) => `${count} ${count === 1 ? "item" : "items"}`,
    postDate: "Post date",
    folder: "Folder",
    noFolder: "No folder",
    archivedAt: "First archived",
    lastSeenAt: "Last seen",
    status: "Status",
    current: "Current",
    archived: "Archived",
    text: "Text",
  },
  pt_BR: {
    title: "ARQUIVO BOOKMARK X",
    items: (count: number) => `${count} ${count === 1 ? "item" : "itens"}`,
    postDate: "Data do post",
    folder: "Pasta",
    noFolder: "Sem pasta",
    archivedAt: "Primeiro arquivamento",
    lastSeenAt: "Visto por último",
    status: "Situação",
    current: "Atual",
    archived: "Arquivado",
    text: "Texto",
  },
  ja: {
    title: "BOOKMARK X アーカイブ",
    items: (count: number) => `${count}件`,
    postDate: "投稿日",
    folder: "フォルダー",
    noFolder: "フォルダーなし",
    archivedAt: "初回保存日時",
    lastSeenAt: "最終確認日時",
    status: "状態",
    current: "現在",
    archived: "アーカイブ済み",
    text: "本文",
  },
  es: {
    title: "ARCHIVO BOOKMARK X",
    items: (count: number) => `${count} ${count === 1 ? "elemento" : "elementos"}`,
    postDate: "Fecha de publicación",
    folder: "Carpeta",
    noFolder: "Sin carpeta",
    archivedAt: "Primer archivado",
    lastSeenAt: "Visto por última vez",
    status: "Estado",
    current: "Actual",
    archived: "Archivado",
    text: "Texto",
  },
  zh_CN: {
    title: "BOOKMARK X 存档",
    items: (count: number) => `${count} 项`,
    postDate: "发布日期",
    folder: "文件夹",
    noFolder: "无文件夹",
    archivedAt: "首次归档",
    lastSeenAt: "最后查看",
    status: "状态",
    current: "当前",
    archived: "已归档",
    text: "正文",
  },
  de: {
    title: "BOOKMARK-X-ARCHIV",
    items: (count: number) => `${count} ${count === 1 ? "Eintrag" : "Einträge"}`,
    postDate: "Beitragsdatum",
    folder: "Ordner",
    noFolder: "Kein Ordner",
    archivedAt: "Erstmals archiviert",
    lastSeenAt: "Zuletzt gesehen",
    status: "Status",
    current: "Aktuell",
    archived: "Archiviert",
    text: "Text",
  },
  fr: {
    title: "ARCHIVE BOOKMARK X",
    items: (count: number) => `${count} ${count === 1 ? "élément" : "éléments"}`,
    postDate: "Date de publication",
    folder: "Dossier",
    noFolder: "Aucun dossier",
    archivedAt: "Premier archivage",
    lastSeenAt: "Dernière consultation",
    status: "Statut",
    current: "Actuel",
    archived: "Archivé",
    text: "Texte",
  },
  it: {
    title: "ARCHIVIO BOOKMARK X",
    items: (count: number) => `${count} ${count === 1 ? "elemento" : "elementi"}`,
    postDate: "Data del post",
    folder: "Cartella",
    noFolder: "Nessuna cartella",
    archivedAt: "Prima archiviazione",
    lastSeenAt: "Ultima visualizzazione",
    status: "Stato",
    current: "Attuale",
    archived: "Archiviato",
    text: "Testo",
  },
} as const;

function byNewestPost(first: BookmarkRecord, second: BookmarkRecord): number {
  return second.postCreatedAt.localeCompare(first.postCreatedAt);
}

function normalizeText(text: string): string {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trimEnd();
}

function renderFullBookmark(
  bookmark: BookmarkRecord,
  labels: (typeof copy)[keyof typeof copy],
): string {
  const folderNames =
    bookmark.folders.length > 0
      ? bookmark.folders.map((folder) => folder.name).join(", ")
      : labels.noFolder;

  return [
    `@${bookmark.author.username} — ${bookmark.author.name}`,
    `${labels.postDate}: ${bookmark.postCreatedAt}`,
    `${labels.folder}: ${folderNames}`,
    `${labels.archivedAt}: ${bookmark.firstArchivedAt}`,
    `${labels.lastSeenAt}: ${bookmark.lastSeenAt}`,
    `${labels.status}: ${bookmark.isCurrent ? labels.current : labels.archived}`,
    bookmark.url,
    "",
    `${labels.text}:`,
    normalizeText(bookmark.text),
  ].join("\n");
}

export function exportBookmarks(
  bookmarks: readonly BookmarkRecord[],
  options: ExportOptions,
): string {
  if (options.format === "urls") {
    const body = [...bookmarks]
      .sort(byNewestPost)
      .map((bookmark) => bookmark.url)
      .join("\n");

    return `${UTF8_BOM}${body}${body.length > 0 ? "\n" : ""}`;
  }

  const labels = copy[options.locale];
  const sorted = [...bookmarks].sort(byNewestPost);
  const header = `${labels.title}\n${labels.items(sorted.length)}`;
  const body = sorted
    .map((bookmark) => renderFullBookmark(bookmark, labels))
    .join("\n\n────────────────────────────────────────\n\n");

  return `${UTF8_BOM}${header}${body.length > 0 ? `\n\n${body}` : ""}\n`;
}
