const TWEET_SELECTOR = 'article[data-testid="tweet"]';

export interface TimelineAdvanceOptions {
  viewportHeight: number;
  scrollBy: () => void;
}

export type TimelineAdvanceResult = "anchor" | "fallback";

function topLevelTweets(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TWEET_SELECTOR)).filter(
    (article) => !article.parentElement?.closest(TWEET_SELECTOR),
  );
}

export function advanceTimeline(
  root: ParentNode,
  { viewportHeight, scrollBy }: TimelineAdvanceOptions,
): TimelineAdvanceResult {
  const anchor = topLevelTweets(root).at(-1);
  const anchorIsAhead =
    anchor && anchor.getBoundingClientRect().top > viewportHeight * 0.25;

  if (!anchor || !anchorIsAhead) {
    scrollBy();
    return "fallback";
  }

  anchor.scrollIntoView({ behavior: "auto", block: "start" });
  return "anchor";
}
