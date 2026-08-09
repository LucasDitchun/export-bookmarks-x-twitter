import { describe, expect, it } from "vitest";

import {
  ALLOWED_RELEASE_PREPARATION_PATHS,
  assertReleasePreparationChanges,
  readReleasePreparationArguments,
} from "./release-preparation-policy.mjs";

describe("release preparation diff policy", () => {
  it("accepts pnpm's argument separator", () => {
    expect(
      readReleasePreparationArguments([
        "--",
        "--base-ref",
        "base",
        "--head-ref",
        "head",
      ]),
    ).toEqual({ baseRef: "base", headRef: "head" });
  });

  it("allows only the five generated release paths", () => {
    expect(ALLOWED_RELEASE_PREPARATION_PATHS).toEqual([
      "CHANGELOG.md",
      "download/bookmark-x.zip",
      "package.json",
      "pnpm-lock.yaml",
      "public/manifest.json",
    ]);
    expect(() =>
      assertReleasePreparationChanges([
        { path: "CHANGELOG.md", status: "A" },
        { path: "download/bookmark-x.zip", status: "M" },
        { path: "package.json", status: "M" },
        { path: "public/manifest.json", status: "M" },
      ]),
    ).not.toThrow();
  });

  it("rejects source changes and destructive statuses", () => {
    expect(() =>
      assertReleasePreparationChanges([
        { path: "CHANGELOG.md", status: "A" },
        { path: "download/bookmark-x.zip", status: "M" },
        { path: "package.json", status: "M" },
        { path: "public/manifest.json", status: "M" },
        { path: "src/background/service-worker.ts", status: "M" },
      ]),
    ).toThrow("Release preparation changed forbidden path");
    expect(() =>
      assertReleasePreparationChanges([
        { path: "CHANGELOG.md", status: "D" },
        { path: "download/bookmark-x.zip", status: "M" },
        { path: "package.json", status: "M" },
        { path: "public/manifest.json", status: "M" },
      ]),
    ).toThrow("Release preparation may only add or modify files");
  });

  it("requires changelog, stable ZIP, package, and manifest changes", () => {
    expect(() =>
      assertReleasePreparationChanges([
        { path: "CHANGELOG.md", status: "A" },
        { path: "package.json", status: "M" },
        { path: "public/manifest.json", status: "M" },
      ]),
    ).toThrow("Release preparation is missing required path: download/bookmark-x.zip");
  });
});
