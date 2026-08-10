import type { BookmarkSnapshot } from "../domain/types";
import { extractBookmarkMedia } from "./bookmark-media";

const STATUS_PATH = /^\/([A-Za-z0-9_]+)\/status\/(\d+)(?:\/|$)/;

function normalizedText(element: Element | null | undefined): string {
  return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function statusDetails(article: Element): {
  id: string;
  username: string;
  url: string;
} | null {
  const timestampAnchor = article
    .querySelector("time[datetime]")
    ?.closest<HTMLAnchorElement>("a[href]");
  const anchors = Array.from(article.querySelectorAll<HTMLAnchorElement>("a[href]"));
  if (timestampAnchor) {
    const timestampIndex = anchors.indexOf(timestampAnchor);
    if (timestampIndex >= 0) anchors.splice(timestampIndex, 1);
    anchors.unshift(timestampAnchor);
  }

  for (const anchor of anchors) {
    let url: URL;
    try {
      url = new URL(anchor.getAttribute("href") ?? "", "https://x.com");
    } catch {
      continue;
    }

    if (url.hostname !== "x.com" && url.hostname !== "www.x.com") {
      continue;
    }

    const match = STATUS_PATH.exec(url.pathname);
    if (!match) {
      continue;
    }

    const username = match[1];
    const id = match[2];
    if (!username || !id) continue;
    return {
      id,
      username,
      url: `https://x.com/${username}/status/${id}`,
    };
  }

  return null;
}

function authorName(article: Element, username: string): string {
  const userName = article.querySelector('[data-testid="User-Name"]');
  const profileLink = Array.from(
    userName?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? [],
  ).find(
    (anchor) =>
      anchor.getAttribute("href")?.toLocaleLowerCase() ===
      `/${username.toLocaleLowerCase()}`,
  );
  const linkedName = normalizedText(profileLink);
  if (linkedName && !linkedName.startsWith("@")) {
    return linkedName;
  }

  const candidates = Array.from(userName?.querySelectorAll("span") ?? [])
    .map(normalizedText)
    .filter(
      (value) =>
        value.length > 0 &&
        !value.startsWith("@") &&
        value !== "·" &&
        value.toLocaleLowerCase() !== username.toLocaleLowerCase(),
    );
  return candidates[0] ?? username;
}

export function extractBookmarks(root: ParentNode = document): BookmarkSnapshot[] {
  const bookmarks = new Map<string, BookmarkSnapshot>();
  const descendants = Array.from(root.querySelectorAll('article[data-testid="tweet"]'));
  const articles =
    root instanceof Element && root.matches('article[data-testid="tweet"]')
      ? [root, ...descendants]
      : descendants;

  for (const article of articles) {
    const details = statusDetails(article);
    if (!details || bookmarks.has(details.id)) {
      continue;
    }

    const time = article.querySelector<HTMLTimeElement>("time[datetime]");
    bookmarks.set(details.id, {
      id: details.id,
      text: normalizedText(article.querySelector('[data-testid="tweetText"]')),
      url: details.url,
      author: {
        id: details.username.toLocaleLowerCase(),
        username: details.username,
        name: authorName(article, details.username),
      },
      postCreatedAt: time?.dateTime ?? "",
      media: extractBookmarkMedia(article, details.url),
    });
  }

  return [...bookmarks.values()];
}
