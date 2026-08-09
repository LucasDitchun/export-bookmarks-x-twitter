import type { BookmarkFolder, BookmarkRecord, ExportOptions } from "./types";

type ExportableBookmark = BookmarkRecord & {
  folders?: readonly BookmarkFolder[];
};

const UTF8_BOM = "\uFEFF";

const copy = {
  en: {
    title: "BOOKMARK X ARCHIVE",
    items: (count: number) => `${count} ${count === 1 ? "item" : "items"}`,
    postDate: "Post date",
    folder: "Folder",
    noFolder: "No folder",
    firstSavedAt: "First saved",
    lastSeenAt: "Last seen",
    text: "Text",
  },
  pt_BR: {
    title: "ARQUIVO BOOKMARK X",
    items: (count: number) => `${count} ${count === 1 ? "item" : "itens"}`,
    postDate: "Data do post",
    folder: "Pasta",
    noFolder: "Sem pasta",
    firstSavedAt: "Primeiro salvamento",
    lastSeenAt: "Visto por último",
    text: "Texto",
  },
  ja: {
    title: "BOOKMARK X アーカイブ",
    items: (count: number) => `${count}件`,
    postDate: "投稿日",
    folder: "フォルダー",
    noFolder: "フォルダーなし",
    firstSavedAt: "初回保存日時",
    lastSeenAt: "最終確認日時",
    text: "本文",
  },
  es: {
    title: "ARCHIVO BOOKMARK X",
    items: (count: number) => `${count} ${count === 1 ? "elemento" : "elementos"}`,
    postDate: "Fecha de publicación",
    folder: "Carpeta",
    noFolder: "Sin carpeta",
    firstSavedAt: "Primer guardado",
    lastSeenAt: "Visto por última vez",
    text: "Texto",
  },
  zh_CN: {
    title: "BOOKMARK X 存档",
    items: (count: number) => `${count} 项`,
    postDate: "发布日期",
    folder: "文件夹",
    noFolder: "无文件夹",
    firstSavedAt: "首次保存",
    lastSeenAt: "最后查看",
    text: "正文",
  },
  de: {
    title: "BOOKMARK-X-ARCHIV",
    items: (count: number) => `${count} ${count === 1 ? "Eintrag" : "Einträge"}`,
    postDate: "Beitragsdatum",
    folder: "Ordner",
    noFolder: "Kein Ordner",
    firstSavedAt: "Erstmals gespeichert",
    lastSeenAt: "Zuletzt gesehen",
    text: "Text",
  },
  fr: {
    title: "ARCHIVE BOOKMARK X",
    items: (count: number) => `${count} ${count === 1 ? "élément" : "éléments"}`,
    postDate: "Date de publication",
    folder: "Dossier",
    noFolder: "Aucun dossier",
    firstSavedAt: "Première sauvegarde",
    lastSeenAt: "Dernière consultation",
    text: "Texte",
  },
  it: {
    title: "ARCHIVIO BOOKMARK X",
    items: (count: number) => `${count} ${count === 1 ? "elemento" : "elementi"}`,
    postDate: "Data del post",
    folder: "Cartella",
    noFolder: "Nessuna cartella",
    firstSavedAt: "Primo salvataggio",
    lastSeenAt: "Ultima visualizzazione",
    text: "Testo",
  },
} as const;

function byNewestPost(first: ExportableBookmark, second: ExportableBookmark): number {
  return second.postCreatedAt.localeCompare(first.postCreatedAt);
}

function normalizeText(text: string): string {
  return text.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trimEnd();
}

function renderFullBookmark(
  bookmark: ExportableBookmark,
  labels: (typeof copy)[keyof typeof copy],
): string {
  const folderNames =
    bookmark.folders !== undefined && bookmark.folders.length > 0
      ? bookmark.folders.map(({ name }) => name).join(", ")
      : labels.noFolder;

  return [
    `@${bookmark.author.username} — ${bookmark.author.name}`,
    `${labels.postDate}: ${bookmark.postCreatedAt}`,
    `${labels.folder}: ${folderNames}`,
    `${labels.firstSavedAt}: ${bookmark.firstSavedAt}`,
    `${labels.lastSeenAt}: ${bookmark.lastSeenAt}`,
    bookmark.url,
    "",
    `${labels.text}:`,
    normalizeText(bookmark.text),
  ].join("\n");
}

export function exportBookmarks(
  bookmarks: readonly ExportableBookmark[],
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
