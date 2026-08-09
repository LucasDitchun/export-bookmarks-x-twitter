export const GITHUB_REPOSITORY_URL =
  "https://github.com/LucasDitchun/export-bookmarks-x-twitter";
export const GITHUB_API_URL =
  "https://api.github.com/repos/LucasDitchun/export-bookmarks-x-twitter";
export const GITHUB_CACHE_KEY = "githubProjectStats";
export const GITHUB_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

interface GithubProjectCache {
  stars: number | null;
  fetchedAt: number;
}

export interface GithubCacheStorage {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
}

interface GithubStarCountOptions {
  storage: GithubCacheStorage;
  fetcher?: typeof fetch;
  now?: () => number;
}

function isValidStarCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

function validFreshCache(value: unknown, now: number): GithubProjectCache | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    (candidate.stars !== null && !isValidStarCount(candidate.stars)) ||
    typeof candidate.fetchedAt !== "number" ||
    !Number.isFinite(candidate.fetchedAt) ||
    candidate.fetchedAt < 0 ||
    candidate.fetchedAt > now ||
    now - candidate.fetchedAt >= GITHUB_CACHE_TTL_MS
  ) {
    return undefined;
  }
  return {
    stars: candidate.stars,
    fetchedAt: candidate.fetchedAt,
  };
}

export async function getGithubStarCount(
  options: GithubStarCountOptions,
): Promise<number | null> {
  const now = options.now?.() ?? Date.now();
  try {
    const stored = await options.storage.get(GITHUB_CACHE_KEY);
    const cached = validFreshCache(stored[GITHUB_CACHE_KEY], now);
    if (cached !== undefined) return cached.stars;
  } catch {
    // A cache failure must not prevent a best-effort public request.
  }

  let stars: number | null = null;
  try {
    const response = await (options.fetcher ?? fetch)(GITHUB_API_URL, {
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/vnd.github+json" },
      referrerPolicy: "no-referrer",
    });
    if (response.ok) {
      const payload: unknown = await response.json();
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const candidate = (payload as Record<string, unknown>).stargazers_count;
        if (isValidStarCount(candidate)) stars = candidate;
      }
    }
  } catch {
    // A failed public check is cached too, preventing repeated offline requests.
  }

  try {
    await options.storage.set({
      [GITHUB_CACHE_KEY]: { stars, fetchedAt: now } satisfies GithubProjectCache,
    });
  } catch {
    // Fresh public data can still be shown when local caching is unavailable.
  }
  return stars;
}
