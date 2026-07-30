// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { extractBookmarks } from "./extract-bookmarks";

function render(markup: string): Document {
  document.body.innerHTML = markup;
  return document;
}

describe("extractBookmarks", () => {
  it("extracts a canonical bookmark snapshot from an X post article", () => {
    const result = extractBookmarks(
      render(`
        <article data-testid="tweet">
          <div data-testid="User-Name">
            <a href="/ada"><span>Ada Lovelace</span></a>
            <span>@ada</span>
          </div>
          <div data-testid="tweetText">First line <span>and second</span></div>
          <a href="/ada/status/123456789?ref_src=twsrc%5Etfw">
            <time datetime="2026-07-28T11:20:00.000Z">Jul 28</time>
          </a>
        </article>
      `),
    );

    expect(result).toEqual([
      {
        id: "123456789",
        text: "First line and second",
        url: "https://x.com/ada/status/123456789",
        author: {
          id: "ada",
          username: "ada",
          name: "Ada Lovelace",
        },
        postCreatedAt: "2026-07-28T11:20:00.000Z",
      },
    ]);
  });

  it("keeps media-only posts and falls back safely when optional DOM is absent", () => {
    const result = extractBookmarks(
      render(`
        <article data-testid="tweet">
          <a href="https://x.com/Grace_Hopper/status/42/photo/1">photo</a>
        </article>
      `),
    );

    expect(result).toEqual([
      expect.objectContaining({
        id: "42",
        text: "",
        url: "https://x.com/Grace_Hopper/status/42",
        author: {
          id: "grace_hopper",
          username: "Grace_Hopper",
          name: "Grace_Hopper",
        },
        postCreatedAt: "",
      }),
    ]);
  });

  it("deduplicates reposted DOM nodes and ignores unrelated or malformed articles", () => {
    const result = extractBookmarks(
      render(`
        <article data-testid="tweet">
          <a href="/person/status/100"><time datetime="2026-01-01T00:00:00Z"></time></a>
        </article>
        <article data-testid="tweet"><a href="/person/status/100/analytics">same</a></article>
        <article data-testid="tweet"><a href="/person/status/not-a-number">bad</a></article>
        <article data-testid="tweet"><a href="/settings/profile">settings</a></article>
      `),
    );

    expect(result.map(({ id }) => id)).toEqual(["100"]);
  });

  it("prefers the timestamp link of the main post over an embedded quoted post", () => {
    const result = extractBookmarks(
      render(`
        <article data-testid="tweet">
          <a href="/quoted/status/999">Quoted post</a>
          <a href="/owner/status/123">
            <time datetime="2026-07-29T12:00:00.000Z">Jul 29</time>
          </a>
        </article>
      `),
    );

    expect(result).toEqual([
      expect.objectContaining({
        id: "123",
        url: "https://x.com/owner/status/123",
      }),
    ]);
  });
});
