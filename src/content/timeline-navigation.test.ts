// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { advanceTimeline } from "./timeline-navigation";

describe("advanceTimeline", () => {
  it("jumps to the last rendered top-level post without anchoring to a quoted post", () => {
    document.body.innerHTML = `
      <main>
        <article id="first" data-testid="tweet"></article>
        <article id="last" data-testid="tweet">
          <article id="quote" data-testid="tweet"></article>
        </article>
      </main>
    `;
    const anchor = document.getElementById("last") as HTMLElement;
    const quote = document.getElementById("quote") as HTMLElement;
    const scrollIntoView = vi.fn();
    const quoteScrollIntoView = vi.fn();
    anchor.scrollIntoView = scrollIntoView;
    quote.scrollIntoView = quoteScrollIntoView;
    anchor.getBoundingClientRect = () => ({ top: 900 }) as DOMRect;

    const result = advanceTimeline(document, {
      viewportHeight: 800,
      scrollBy: vi.fn(),
    });

    expect(result).toBe("anchor");
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "start",
    });
    expect(quoteScrollIntoView).not.toHaveBeenCalled();
  });

  it("falls back to a viewport step when the last rendered post is already near the top", () => {
    document.body.innerHTML =
      '<main><article id="last" data-testid="tweet"></article></main>';
    const anchor = document.getElementById("last") as HTMLElement;
    anchor.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    const scrollIntoView = vi.fn();
    anchor.scrollIntoView = scrollIntoView;
    const scrollBy = vi.fn();

    const result = advanceTimeline(document, {
      viewportHeight: 800,
      scrollBy,
    });

    expect(result).toBe("fallback");
    expect(scrollBy).toHaveBeenCalledOnce();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
