// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { hasReachedPageEnd, isPageLoading } from "./page-state";

describe("isPageLoading", () => {
  it("detects a visible X loading indicator and ignores it once hidden", () => {
    document.body.innerHTML = `
      <main>
        <div id="loader" role="progressbar"></div>
      </main>
    `;

    expect(isPageLoading(document)).toBe(true);

    document.getElementById("loader")?.setAttribute("aria-hidden", "true");
    expect(isPageLoading(document)).toBe(false);
  });

  it("treats X aria-busy timelines as pending but ignores hidden loaders", () => {
    document.body.innerHTML = `
      <main aria-busy="true">
        <div hidden><div role="progressbar"></div></div>
      </main>
    `;
    expect(isPageLoading(document)).toBe(true);

    document.querySelector("main")?.setAttribute("aria-busy", "false");
    expect(isPageLoading(document)).toBe(false);
  });
});

describe("hasReachedPageEnd", () => {
  it("only reports the end when the viewport reaches the document bottom", () => {
    expect(
      hasReachedPageEnd({
        scrollTop: 400,
        viewportHeight: 800,
        documentHeight: 2_000,
      }),
    ).toBe(false);
    expect(
      hasReachedPageEnd({
        scrollTop: 1_196,
        viewportHeight: 800,
        documentHeight: 2_000,
      }),
    ).toBe(true);
  });
});
