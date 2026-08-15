import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  assertPreparedChangelog,
  calculateNextVersion,
  isReleaseCommitSubject,
  parseConventionalCommit,
  updateChangelog,
} from "./release-train.mjs";

const ROOT = resolve(import.meta.dirname, "..", "..");

function commits(type, count) {
  return Array.from({ length: count }, (_, index) => `${type}: change ${index + 1}`);
}

test("ignores release preparation commits after GitHub squash merges", () => {
  assert.equal(isReleaseCommitSubject("chore(release): prepare v0.1.1"), true);
  assert.equal(isReleaseCommitSubject("chore(release): prepare v0.1.1 (#24)"), true);
  assert.equal(isReleaseCommitSubject("chore(staging): prepare v0.1.1"), true);
  assert.equal(isReleaseCommitSubject("chore(release): prepare v0.1.1 later"), false);
  assert.equal(isReleaseCommitSubject("chore(staging): prepare v0.1.1 later"), false);
});

test("batches any number of pre-1.0 features and fixes into one patch", () => {
  const messages = [...commits("feat", 12), ...commits("fix", 19)];

  assert.deepEqual(calculateNextVersion("0.1.0", messages), {
    version: "0.1.1",
    bump: "patch",
  });
});

test("increments pre-1.0 patch once for a fix-only batch", () => {
  assert.equal(calculateNextVersion("0.2.7", commits("fix", 5)).version, "0.2.8");
});

test("increments pre-1.0 patch once for a mixed feature batch", () => {
  assert.equal(
    calculateNextVersion("0.2.37", ["feat: add folders", ...commits("fix", 4)]).version,
    "0.2.38",
  );
});

test("increments post-1.0 major once for a breaking batch", () => {
  assert.equal(
    calculateNextVersion("1.4.2", [
      "feat(storage)!: replace schema",
      ...commits("fix", 3),
    ]).version,
    "2.0.0",
  );
});

test("detects a scoped breaking fix as a breaking change", () => {
  const commit = parseConventionalCommit("fix(storage)!: repair incompatible data");

  assert.equal(commit.type, "fix");
  assert.equal(commit.breaking, true);
  assert.deepEqual(calculateNextVersion("0.4.8", [commit]), {
    version: "0.5.0",
    bump: "minor",
  });
});

test("detects BREAKING CHANGE footers", () => {
  const commit = parseConventionalCommit({
    subject: "fix: migrate persisted settings",
    body: "BREAKING CHANGE: old settings are no longer accepted",
  });

  assert.equal(commit.breaking, true);
  assert.equal(calculateNextVersion("1.2.9", [commit]).version, "2.0.0");
});

test("treats conventional maintenance batches as one patch", () => {
  assert.equal(
    calculateNextVersion("0.1.0", ["docs: clarify installation", "chore: update CI"])
      .version,
    "0.1.1",
  );
  assert.equal(
    calculateNextVersion("1.4.2", ["docs: clarify installation"]).version,
    "1.4.3",
  );
});

test("rejects an empty automatic batch", () => {
  assert.throws(
    () => calculateNextVersion("0.2.4", []),
    /no conventional commits to release/i,
  );
});

test("uses standard single-step manual overrides", () => {
  const messages = ["chore: maintenance"];

  assert.equal(calculateNextVersion("0.2.37", messages, "patch").version, "0.2.38");
  assert.equal(calculateNextVersion("0.2.37", messages, "minor").version, "0.3.0");
  assert.equal(calculateNextVersion("1.4.9", messages, "major").version, "2.0.0");
});

test("uses SemVer precedence after 1.0", () => {
  assert.equal(calculateNextVersion("1.4.2", ["fix: correction"]).version, "1.4.3");
  assert.equal(
    calculateNextVersion("1.4.2", ["feat: folders", "fix: correction"]).version,
    "1.5.0",
  );
});

test("replaces an unshipped changelog section instead of accumulating prepared releases", () => {
  const existing = [
    "# Changelog",
    "",
    "All notable changes to Bookmark X are documented in this file.",
    "",
    "## [0.2.1] - 2026-08-08",
    "",
    "### Fixes",
    "",
    "- old prepared fix (`aaaaaaa`)",
    "",
    "## [0.1.0] - 2026-07-29",
    "",
    "### Features",
    "",
    "- initial release (`bbbbbbb`)",
    "",
  ].join("\n");

  const updated = updateChangelog({
    contents: existing,
    baseVersion: "0.1.0",
    version: "0.2.2",
    date: "2026-08-09",
    commits: [
      { sha: "cccccccc", subject: "feat: folders" },
      { sha: "dddddddd", subject: "fix: preserve notes" },
    ],
  });

  assert.match(updated, /^# Changelog\n/m);
  assert.match(updated, /^## \[0\.2\.2\] - 2026-08-09$/m);
  assert.doesNotMatch(updated, /^## \[0\.2\.1\]/m);
  assert.match(updated, /^## \[0\.1\.0\] - 2026-07-29$/m);
  assert.match(updated, /- initial release \(`bbbbbbb`\)/m);
  assert.match(updated, /### Features[\s\S]*- folders \(`ccccccc`\)/m);
  assert.match(updated, /### Fixes[\s\S]*- preserve notes \(`ddddddd`\)/m);
});

test("rejects a prepared changelog that omits a commit from the release range", () => {
  const contents = [
    "# Changelog",
    "",
    "All notable changes to Bookmark X are documented in this file.",
    "",
    "## [0.1.1] - 2026-08-09",
    "",
    "### Features",
    "",
    "- folders (`ccccccc`)",
    "",
    "## [0.1.0] - 2026-07-29",
    "",
    "### Features",
    "",
    "- initial release (`bbbbbbb`)",
    "",
  ].join("\n");

  assert.throws(
    () =>
      assertPreparedChangelog({
        contents,
        baseVersion: "0.1.0",
        version: "0.1.1",
        commits: [
          { sha: "cccccccc", subject: "feat: folders" },
          { sha: "dddddddd", subject: "docs: document folders" },
        ],
      }),
    /does not exactly match/i,
  );
});

test("preserves the published 0.1.2 section when preparing the next release", async () => {
  const contents = await readFile(resolve(ROOT, "CHANGELOG.md"), "utf8");

  const updated = updateChangelog({
    contents,
    baseVersion: "0.1.2",
    version: "0.1.3",
    date: "2026-08-15",
    commits: [{ sha: "eeeeeeee", subject: "fix: keep published ancestry" }],
  });

  assert.match(updated, /^## \[0\.1\.3\] - 2026-08-15$/m);
  assert.match(updated, /^## \[0\.1\.2\] - 2026-08-13$/m);
  assert.ok(
    updated.indexOf("## [0.1.3] - 2026-08-15") <
      updated.indexOf("## [0.1.2] - 2026-08-13"),
  );
});
