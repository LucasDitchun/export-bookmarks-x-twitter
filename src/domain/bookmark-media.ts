import type { BookmarkMedia, BookmarkVideoMedia } from "./types";

export const MAX_BOOKMARK_IMAGES = 16;
export const MAX_BOOKMARK_VIDEOS = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

export function emptyBookmarkMedia(): BookmarkMedia {
  return { images: [], videos: [] };
}

export function normalizeStableImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    return null;
  }

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "pbs.twimg.com" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== ""
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function isCanonicalPostUrl(value: unknown, expected: string): value is string {
  if (typeof value !== "string" || value !== expected) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "x.com" || url.hostname === "www.x.com") &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      /^\/[A-Za-z0-9_]+\/status\/\d+$/.test(url.pathname) &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function videoKey(video: BookmarkVideoMedia): string {
  return `${video.postUrl}\u0000${
    video.thumbnailUrl === null ? "" : stableImageIdentity(video.thumbnailUrl)
  }`;
}

function stableImageIdentity(value: string): string {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

export function isBookmarkMedia(
  value: unknown,
  canonicalPostUrl: string,
): value is BookmarkMedia {
  if (!isRecord(value) || !hasExactKeys(value, ["images", "videos"])) return false;
  if (
    !Array.isArray(value.images) ||
    value.images.length > MAX_BOOKMARK_IMAGES ||
    !Array.isArray(value.videos) ||
    value.videos.length > MAX_BOOKMARK_VIDEOS
  ) {
    return false;
  }

  const images = value.images;
  if (
    images.some(
      (image) => typeof image !== "string" || normalizeStableImageUrl(image) !== image,
    ) ||
    new Set(images.map(stableImageIdentity)).size !== images.length
  ) {
    return false;
  }

  const videos: BookmarkVideoMedia[] = [];
  for (const item of value.videos) {
    if (!isRecord(item) || !hasExactKeys(item, ["thumbnailUrl", "postUrl"])) {
      return false;
    }
    if (
      !isCanonicalPostUrl(item.postUrl, canonicalPostUrl) ||
      (item.thumbnailUrl !== null &&
        (typeof item.thumbnailUrl !== "string" ||
          normalizeStableImageUrl(item.thumbnailUrl) !== item.thumbnailUrl))
    ) {
      return false;
    }
    videos.push({
      thumbnailUrl: item.thumbnailUrl,
      postUrl: item.postUrl,
    });
  }
  const postsWithThumbnail = new Set(
    videos
      .filter(({ thumbnailUrl }) => thumbnailUrl !== null)
      .map(({ postUrl }) => postUrl),
  );
  return (
    new Set(videos.map(videoKey)).size === videos.length &&
    videos.every(
      ({ postUrl, thumbnailUrl }) =>
        thumbnailUrl !== null || !postsWithThumbnail.has(postUrl),
    )
  );
}

function orderedUnique(values: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = stableImageIdentity(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
    if (result.length === MAX_BOOKMARK_IMAGES) break;
  }
  return result;
}

export function mergeBookmarkMedia(
  established: BookmarkMedia,
  observed: BookmarkMedia,
): BookmarkMedia {
  const images = orderedUnique([...established.images, ...observed.images]);
  const combined = [...established.videos, ...observed.videos];
  const postsWithThumbnail = new Set(
    combined
      .filter(({ thumbnailUrl }) => thumbnailUrl !== null)
      .map(({ postUrl }) => postUrl),
  );
  const videos: BookmarkVideoMedia[] = [];
  const seen = new Set<string>();
  for (const video of combined) {
    if (video.thumbnailUrl === null && postsWithThumbnail.has(video.postUrl)) {
      continue;
    }
    const key = videoKey(video);
    if (seen.has(key)) continue;
    seen.add(key);
    videos.push(video);
    if (videos.length === MAX_BOOKMARK_VIDEOS) break;
  }
  return { images, videos };
}
