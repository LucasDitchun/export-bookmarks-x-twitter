import type { BookmarkRecord } from "./types";

export const MAX_SEARCH_QUERY_LENGTH = 500;

export type SearchBookmarkView = "current" | "inbox" | "archived";

export interface BookmarkSearchDocument {
  bookmark: BookmarkRecord;
  tagNames: string[];
  folderBreadcrumb: string[];
}

export interface BookmarkSearchHit {
  bookmark: BookmarkRecord;
  score: number;
}

export interface BookmarkSearchIndex {
  readonly documents: readonly IndexedBookmarkSearchDocument[];
}

interface IndexedBookmarkSearchDocument {
  bookmark: BookmarkRecord;
  weightedFields: readonly (readonly [field: string, weight: number])[];
}

function isInbox(bookmark: BookmarkRecord): boolean {
  return (
    bookmark.status === "current" &&
    (bookmark.note.length === 0 ||
      bookmark.folderId === null ||
      bookmark.tagIds.length === 0)
  );
}

function isVisibleInView(bookmark: BookmarkRecord, view: SearchBookmarkView): boolean {
  if (view === "archived") return bookmark.status === "archived";
  if (view === "inbox") return isInbox(bookmark);
  return bookmark.status === "current";
}

function fieldScore(field: string, term: string, weight: number): number {
  if (field === term) return weight + 20;
  if (field.startsWith(term)) return weight + 10;
  return field.includes(term) ? weight : 0;
}

function compareHits(left: BookmarkSearchHit, right: BookmarkSearchHit): number {
  if (left.score !== right.score) return right.score - left.score;
  const savedOrder = right.bookmark.firstSavedAt.localeCompare(
    left.bookmark.firstSavedAt,
  );
  return savedOrder || right.bookmark.id.localeCompare(left.bookmark.id, "und");
}

export function createBookmarkSearchIndex(
  documents: readonly BookmarkSearchDocument[],
): BookmarkSearchIndex {
  return {
    documents: documents.map(({ bookmark, tagNames, folderBreadcrumb }) => ({
      bookmark,
      weightedFields: [
        [normalizeSearchText(bookmark.text), 100],
        [normalizeSearchText(bookmark.author.username), 80],
        [normalizeSearchText(bookmark.author.name), 70],
        [normalizeSearchText(bookmark.note), 60],
        [normalizeSearchText(tagNames.join(" ")), 75],
        [normalizeSearchText(folderBreadcrumb.join(" ")), 65],
      ],
    })),
  };
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("und")
    .replace(/\s+/gu, " ")
    .trim();
}

export function searchBookmarkDocuments(
  documents: readonly BookmarkSearchDocument[],
  query: string,
  view: SearchBookmarkView,
): BookmarkSearchHit[] {
  return searchBookmarkIndex(createBookmarkSearchIndex(documents), query, view);
}

export function searchBookmarkIndex(
  index: BookmarkSearchIndex,
  query: string,
  view: SearchBookmarkView,
): BookmarkSearchHit[] {
  const normalizedQuery = normalizeSearchText(query);
  const queryTerms = normalizedQuery.split(" ").filter(Boolean);
  if (queryTerms.length === 0) return [];
  return index.documents
    .flatMap(({ bookmark, weightedFields }) => {
      if (!isVisibleInView(bookmark, view)) return [];
      let score = 0;
      for (const term of queryTerms) {
        const bestFieldScore = Math.max(
          ...weightedFields.map(([field, weight]) => fieldScore(field, term, weight)),
        );
        if (bestFieldScore === 0) return [];
        score += bestFieldScore;
      }
      if (
        normalizedQuery.includes(" ") &&
        weightedFields.some(([field]) => field.includes(normalizedQuery))
      ) {
        score += 25;
      }
      return [{ bookmark, score }];
    })
    .sort(compareHits);
}
