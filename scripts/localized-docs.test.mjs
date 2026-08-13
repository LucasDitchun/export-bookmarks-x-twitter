import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const guides = [
  "pt-BR/USER_GUIDE.md",
  "ja/USER_GUIDE.md",
  "es/USER_GUIDE.md",
  "zh-CN/USER_GUIDE.md",
  "de/USER_GUIDE.md",
  "fr/USER_GUIDE.md",
  "it/USER_GUIDE.md",
];

describe("localized user guides", () => {
  it("ships one actionable guide for every non-English UI locale", async () => {
    for (const guide of guides) {
      const path = resolve(root, "docs/i18n", guide);
      const content = await readFile(path, "utf8");

      expect(content.match(/^## /gmu)).toHaveLength(6);
      expect(content).toContain("https://x.com/i/bookmarks");
      expect(content).toContain("chrome://extensions");
      expect(content).toContain("../../../download/bookmark-x.zip?raw=1");
      await access(resolve(dirname(path), "../../../download/bookmark-x.zip"));
    }
  });

  it("links every translated guide from the canonical README", async () => {
    const readme = await readFile(resolve(root, "README.md"), "utf8");

    for (const guide of guides) {
      expect(readme).toContain(`docs/i18n/${guide}`);
    }
  });
});
