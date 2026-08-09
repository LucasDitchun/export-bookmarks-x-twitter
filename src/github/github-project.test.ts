import { describe, expect, it, vi } from "vitest";

import {
  GITHUB_API_URL,
  GITHUB_CACHE_KEY,
  GITHUB_CACHE_TTL_MS,
  getGithubStarCount,
  type GithubCacheStorage,
} from "./github-project";

function storageWith(value?: unknown): GithubCacheStorage & {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
} {
  return {
    get: vi.fn(async () => (value === undefined ? {} : { [GITHUB_CACHE_KEY]: value })),
    set: vi.fn(async () => undefined),
  };
}

describe("GitHub project star count", () => {
  it("uses a valid cache for a full 24-hour window without making a request", async () => {
    const now = Date.UTC(2026, 7, 9, 12);
    const storage = storageWith({
      stars: 321,
      fetchedAt: now - GITHUB_CACHE_TTL_MS + 1,
    });
    const fetcher = vi.fn();

    await expect(
      getGithubStarCount({ storage, fetcher, now: () => now }),
    ).resolves.toBe(321);
    expect(fetcher).not.toHaveBeenCalled();
    expect(storage.set).not.toHaveBeenCalled();
  });

  it("honors a cached failed check so offline settings visits do not hammer GitHub", async () => {
    const now = Date.UTC(2026, 7, 9, 12);
    const storage = storageWith({ stars: null, fetchedAt: now - 1_000 });
    const fetcher = vi.fn();

    await expect(
      getGithubStarCount({ storage, fetcher, now: () => now }),
    ).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refreshes an expired cache from the fixed public endpoint and stores only stats", async () => {
    const now = Date.UTC(2026, 7, 9, 12);
    const storage = storageWith({ stars: 10, fetchedAt: now - GITHUB_CACHE_TTL_MS });
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ stargazers_count: 456, private: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    await expect(
      getGithubStarCount({ storage, fetcher, now: () => now }),
    ).resolves.toBe(456);
    expect(fetcher).toHaveBeenCalledWith(
      GITHUB_API_URL,
      expect.objectContaining({
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      }),
    );
    const requestOptions = fetcher.mock.calls[0]?.[1];
    expect(requestOptions).not.toHaveProperty("body");
    expect(requestOptions?.headers).toEqual({
      Accept: "application/vnd.github+json",
    });
    expect(storage.set).toHaveBeenCalledWith({
      [GITHUB_CACHE_KEY]: { stars: 456, fetchedAt: now },
    });
  });

  it.each([
    ["network failure", () => Promise.reject(new Error("offline"))],
    [
      "non-success response",
      () => Promise.resolve(new Response("rate limited", { status: 403 })),
    ],
    [
      "invalid response",
      () => Promise.resolve(new Response(JSON.stringify({ stargazers_count: -1 }))),
    ],
    [
      "fractional count",
      () => Promise.resolve(new Response(JSON.stringify({ stargazers_count: 1.5 }))),
    ],
  ])(
    "hides the count after %s and throttles the next retry",
    async (_label, fetcher) => {
      const now = GITHUB_CACHE_TTL_MS + 10_000;
      const storage = storageWith({ stars: 10, fetchedAt: 0 });

      await expect(
        getGithubStarCount({ storage, fetcher: vi.fn(fetcher), now: () => now }),
      ).resolves.toBeNull();
      expect(storage.set).toHaveBeenCalledWith({
        [GITHUB_CACHE_KEY]: { stars: null, fetchedAt: now },
      });
    },
  );

  it("ignores malformed and future-dated cache entries", async () => {
    const now = 10_000;
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ stargazers_count: 7 }), { status: 200 }),
    );

    for (const cached of [
      { stars: "7", fetchedAt: 9_000 },
      { stars: 7, fetchedAt: now + 1 },
      null,
    ]) {
      const storage = storageWith(cached);
      await expect(
        getGithubStarCount({ storage, fetcher, now: () => now }),
      ).resolves.toBe(7);
    }
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("can still return public data when cache access is unavailable", async () => {
    const storage: GithubCacheStorage = {
      get: vi.fn(async () => {
        throw new Error("storage unavailable");
      }),
      set: vi.fn(async () => {
        throw new Error("storage unavailable");
      }),
    };
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ stargazers_count: 88 }), { status: 200 }),
    );

    await expect(
      getGithubStarCount({ storage, fetcher, now: () => 20_000 }),
    ).resolves.toBe(88);
  });
});
