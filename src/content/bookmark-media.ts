import type { BookmarkMedia, BookmarkVideoMedia } from "../domain/types";

const MAX_BOOKMARK_IMAGES = 16;
const MAX_BOOKMARK_VIDEOS = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStableImageUrl(value: unknown): string | null {
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

function stableImageIdentity(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

function selectedImageUrl(image: HTMLImageElement): string | null {
  return (
    normalizeStableImageUrl(image.currentSrc) ??
    normalizeStableImageUrl(image.getAttribute("src") || image.src)
  );
}

function normalizedVideos(videos: readonly BookmarkVideoMedia[]) {
  const postsWithThumbnail = new Set(
    videos
      .filter(({ thumbnailUrl }) => thumbnailUrl !== null)
      .map(({ postUrl }) => postUrl),
  );
  const result: BookmarkVideoMedia[] = [];
  const seen = new Set<string>();
  for (const video of videos) {
    if (video.thumbnailUrl === null && postsWithThumbnail.has(video.postUrl)) {
      continue;
    }
    const key = `${video.postUrl}\u0000${
      video.thumbnailUrl === null ? "" : stableImageIdentity(video.thumbnailUrl)
    }`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(video);
    if (result.length === MAX_BOOKMARK_VIDEOS) break;
  }
  return result;
}

export function extractBookmarkMedia(
  article: Element,
  canonicalPostUrl: string,
): BookmarkMedia {
  const images: string[] = [];
  const seenImages = new Set<string>();
  for (const image of Array.from(
    article.querySelectorAll<HTMLImageElement>('[data-testid="tweetPhoto"] img'),
  )) {
    const url = selectedImageUrl(image);
    if (url === null) continue;
    const key = stableImageIdentity(url);
    if (seenImages.has(key)) continue;
    seenImages.add(key);
    images.push(url);
    if (images.length === MAX_BOOKMARK_IMAGES) break;
  }

  const videoElements = Array.from(article.querySelectorAll<HTMLVideoElement>("video"));
  const candidates: BookmarkVideoMedia[] = videoElements.map((video) => ({
    thumbnailUrl: normalizeStableImageUrl(video.poster || video.getAttribute("poster")),
    postUrl: canonicalPostUrl,
  }));
  for (const container of Array.from(
    article.querySelectorAll<HTMLElement>(
      '[data-testid="videoPlayer"], [data-testid="videoComponent"]',
    ),
  )) {
    if (container.querySelector("video")) continue;
    const thumbnail = container.querySelector<HTMLImageElement>("img");
    candidates.push({
      thumbnailUrl: thumbnail ? selectedImageUrl(thumbnail) : null,
      postUrl: canonicalPostUrl,
    });
  }

  return { images, videos: normalizedVideos(candidates) };
}

export function isContentBookmarkMedia(
  value: unknown,
  canonicalPostUrl: string,
): value is BookmarkMedia {
  if (
    !isRecord(value) ||
    !Array.isArray(value.images) ||
    !Array.isArray(value.videos)
  ) {
    return false;
  }
  if (
    value.images.length > MAX_BOOKMARK_IMAGES ||
    value.videos.length > MAX_BOOKMARK_VIDEOS ||
    value.images.some(
      (image) => typeof image !== "string" || normalizeStableImageUrl(image) !== image,
    )
  ) {
    return false;
  }
  return value.videos.every(
    (video) =>
      isRecord(video) &&
      video.postUrl === canonicalPostUrl &&
      (video.thumbnailUrl === null ||
        (typeof video.thumbnailUrl === "string" &&
          normalizeStableImageUrl(video.thumbnailUrl) === video.thumbnailUrl)),
  );
}
