import type { BookmarkRecord } from "./types";

export const SEMANTIC_EMBEDDING_DIMENSIONS = 384;
export const DEFAULT_RRF_K = 60;

export interface SemanticSourceDocument {
  bookmark: BookmarkRecord;
  tagNames: string[];
  folderBreadcrumb: string[];
}

export interface FusedSearchHit {
  bookmark: BookmarkRecord;
  score: number;
  sources: { lexical: boolean; semantic: boolean };
}

function line(label: string, value: string): string | null {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length === 0 ? null : `${label}: ${normalized}`;
}

/**
 * E5 was trained with asymmetric `query:` / `passage:` prefixes. This function
 * creates the passage locally; its return value is never sent to Bookmark X or
 * Hugging Face.
 */
export function buildSemanticPassage(document: SemanticSourceDocument): string {
  const { bookmark } = document;
  const values = [
    `passage: ${bookmark.text.replace(/\s+/gu, " ").trim()}`,
    line("Author", `${bookmark.author.name} (@${bookmark.author.username})`),
    line("Note", bookmark.note),
    line("Tags", document.tagNames.join(", ")),
    line("Folder", document.folderBreadcrumb.join(" / ")),
  ];
  return values.filter((value): value is string => value !== null).join("\n");
}

export async function semanticDocumentFingerprint(
  document: SemanticSourceDocument,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      id: document.bookmark.id,
      passage: buildSemanticPassage(document),
      status: document.bookmark.status,
    }),
  );
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

interface AccumulatedHit {
  bookmark: BookmarkRecord;
  score: number;
  lexicalRank: number | null;
  semanticRank: number | null;
}

function addRanking(
  accumulated: Map<string, AccumulatedHit>,
  ranking: readonly BookmarkRecord[],
  source: "lexicalRank" | "semanticRank",
  k: number,
): void {
  const seen = new Set<string>();
  let uniqueRank = 0;
  for (const bookmark of ranking) {
    if (seen.has(bookmark.id)) continue;
    seen.add(bookmark.id);
    uniqueRank += 1;
    const current = accumulated.get(bookmark.id) ?? {
      bookmark,
      score: 0,
      lexicalRank: null,
      semanticRank: null,
    };
    current.score += 1 / (k + uniqueRank);
    current[source] = uniqueRank;
    accumulated.set(bookmark.id, current);
  }
}

/** Reciprocal Rank Fusion with lexical-first deterministic tie breaking. */
export function reciprocalRankFusion(
  lexical: readonly BookmarkRecord[],
  semantic: readonly BookmarkRecord[],
  k = DEFAULT_RRF_K,
): FusedSearchHit[] {
  if (!Number.isFinite(k) || k <= 0) throw new RangeError("RRF k must be positive.");
  const accumulated = new Map<string, AccumulatedHit>();
  addRanking(accumulated, lexical, "lexicalRank", k);
  addRanking(accumulated, semantic, "semanticRank", k);
  return [...accumulated.values()]
    .sort((left, right) => {
      const score = right.score - left.score;
      if (score !== 0) return score;
      const lexicalRank =
        (left.lexicalRank ?? Number.POSITIVE_INFINITY) -
        (right.lexicalRank ?? Number.POSITIVE_INFINITY);
      if (lexicalRank !== 0) return lexicalRank;
      const semanticRank =
        (left.semanticRank ?? Number.POSITIVE_INFINITY) -
        (right.semanticRank ?? Number.POSITIVE_INFINITY);
      return semanticRank || left.bookmark.id.localeCompare(right.bookmark.id, "und");
    })
    .map(({ bookmark, score, lexicalRank, semanticRank }) => ({
      bookmark,
      score,
      sources: {
        lexical: lexicalRank !== null,
        semantic: semanticRank !== null,
      },
    }));
}
