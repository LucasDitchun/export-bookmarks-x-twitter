import { describe, expect, it } from "vitest";

import { validateContentScriptBundle } from "./content-script-bundle-policy.mjs";

describe("MV3 classic content-script bundle policy", () => {
  it.each([
    ['import{categorize}from"./assets/bookmark-categorization-123.js";', "import"],
    ['const load=()=>import("./assets/bookmark-categorization-123.js");', "import"],
    ["export{categorize};", "export"],
    [
      'const chunk="./assets/bookmark-categorization-123.js";',
      "local JavaScript chunk",
    ],
    ['const chunk="../chunks/shared.js";', "local JavaScript chunk"],
  ])("rejects a bundle containing %s", (javascript, expectedReason) => {
    expect(() => validateContentScriptBundle(javascript)).toThrow(expectedReason);
  });

  it("accepts a self-contained classic-script IIFE", () => {
    expect(() =>
      validateContentScriptBundle(
        '(()=>{const category="reference";void category;})();',
      ),
    ).not.toThrow();
  });

  it("rejects a classic script that is not an IIFE entrypoint", () => {
    expect(() => validateContentScriptBundle('const category="reference";')).toThrow(
      "IIFE entrypoint",
    );
  });
});
