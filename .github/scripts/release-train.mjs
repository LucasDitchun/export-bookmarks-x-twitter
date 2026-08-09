#!/usr/bin/env node

import { appendFile, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..", "..");
const PACKAGE_PATH = resolve(ROOT, "package.json");
const MANIFEST_PATH = resolve(ROOT, "public", "manifest.json");
const CHANGELOG_PATH = resolve(ROOT, "CHANGELOG.md");
const DOWNLOAD_PATH = resolve(ROOT, "download", "bookmark-x.zip");
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const CONVENTIONAL_PATTERN =
  /^(?<type>[a-zA-Z][a-zA-Z0-9-]*)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?: (?<summary>.+)$/u;
const BREAKING_FOOTER_PATTERN = /^BREAKING(?: |-)?CHANGE:\s*.+$/imu;
const RELEASE_COMMIT_PATTERN = /^chore\(release\): prepare v\d+\.\d+\.\d+$/u;
const MAXIMUM_CHROME_COMPONENT = 65_535;

export class Version {
  constructor(major, minor, patch) {
    this.major = major;
    this.minor = minor;
    this.patch = patch;
    this.assertChromeCompatible();
  }

  static parse(value, label = "Version") {
    const match = VERSION_PATTERN.exec(String(value).trim());
    if (!match) {
      throw new Error(`${label} must use MAJOR.MINOR.PATCH.`);
    }

    return new Version(...match.slice(1).map(Number));
  }

  compare(other) {
    return (
      this.major - other.major || this.minor - other.minor || this.patch - other.patch
    );
  }

  assertChromeCompatible() {
    if (
      [this.major, this.minor, this.patch].some(
        (component) => component > MAXIMUM_CHROME_COMPONENT,
      )
    ) {
      throw new Error(
        `Version components must not exceed ${MAXIMUM_CHROME_COMPONENT}, as required by Chrome.`,
      );
    }
  }

  toString() {
    return `${this.major}.${this.minor}.${this.patch}`;
  }
}

export function parseConventionalCommit(input) {
  const source = typeof input === "string" ? { subject: input } : input;
  if (!source || typeof source !== "object") {
    throw new Error("Commit must be a Conventional Commit subject or object.");
  }

  const subject = String(source.subject ?? "").trim();
  const body = String(source.body ?? "").trim();
  const match = CONVENTIONAL_PATTERN.exec(subject);
  if (!match?.groups) {
    throw new Error(
      `Commit is not Conventional Commit formatted: ${subject || "<empty>"}`,
    );
  }

  return {
    sha: String(source.sha ?? "").trim(),
    subject,
    body,
    type: match.groups.type.toLowerCase(),
    scope: match.groups.scope ?? null,
    summary: match.groups.summary,
    breaking: match.groups.breaking === "!" || BREAKING_FOOTER_PATTERN.test(body),
  };
}

function normalizeCommits(commits) {
  if (!Array.isArray(commits)) {
    throw new Error("Commits must be an array.");
  }

  return commits.map((commit) => parseConventionalCommit(commit));
}

export function calculateNextVersion(currentVersion, commits, override = "auto") {
  const current = Version.parse(currentVersion, "Current version");
  const parsedCommits = normalizeCommits(commits);
  const hasFeature = parsedCommits.some((commit) => commit.type === "feat");
  const hasBreakingChange = parsedCommits.some((commit) => commit.breaking);

  if (!new Set(["auto", "patch", "minor", "major"]).has(override)) {
    throw new Error(`Unsupported release override: ${override}`);
  }

  let bump = override;
  if (override === "auto") {
    if (parsedCommits.length === 0) {
      throw new Error("Automatic release has no Conventional Commits to release.");
    }
    if (hasBreakingChange) {
      bump = current.major === 0 ? "minor" : "major";
    } else if (current.major > 0 && hasFeature) {
      bump = "minor";
    } else {
      bump = "patch";
    }
  }

  if (parsedCommits.length === 0) {
    throw new Error("Release has no Conventional Commits to release.");
  }

  const next =
    bump === "major"
      ? new Version(current.major + 1, 0, 0)
      : bump === "minor"
        ? new Version(current.major, current.minor + 1, 0)
        : new Version(current.major, current.minor, current.patch + 1);

  return {
    version: next.toString(),
    bump,
  };
}

function renderReleaseSection({ version, date, commits }) {
  const groups = new Map([
    ["Breaking changes", []],
    ["Features", []],
    ["Fixes", []],
    ["Performance", []],
    ["Maintenance", []],
  ]);

  for (const commit of normalizeCommits(commits)) {
    const group = commit.breaking
      ? "Breaking changes"
      : commit.type === "feat"
        ? "Features"
        : commit.type === "fix"
          ? "Fixes"
          : commit.type === "perf"
            ? "Performance"
            : "Maintenance";
    groups.get(group).push(commit);
  }

  const lines = [`## [${version}] - ${date}`, ""];
  for (const [title, entries] of groups) {
    if (entries.length === 0) continue;
    lines.push(`### ${title}`, "");
    for (const entry of entries) {
      const reference = entry.sha ? ` (\`${entry.sha.slice(0, 7)}\`)` : "";
      lines.push(`- ${entry.summary}${reference}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function updateChangelog({ contents, baseVersion, version, date, commits }) {
  const base = Version.parse(baseVersion, "Base version");
  Version.parse(version, "Release version");
  const source = String(contents ?? "");
  if (source.trim() && !source.startsWith("# Changelog")) {
    throw new Error("CHANGELOG.md must begin with '# Changelog'.");
  }

  const defaultHeader =
    "# Changelog\n\n" +
    "All notable changes to Bookmark X are documented in this file.\n";
  const firstSectionIndex = source.search(/^## \[/mu);
  const header =
    firstSectionIndex === -1
      ? source.trimEnd() || defaultHeader.trimEnd()
      : source.slice(0, firstSectionIndex).trimEnd();
  const sectionPattern =
    /^## \[(?<version>\d+\.\d+\.\d+)\][\s\S]*?(?=^## \[|(?![\s\S]))/gmu;
  const shippedSections = [];

  for (const match of source.matchAll(sectionPattern)) {
    const sectionVersion = Version.parse(match.groups.version, "Changelog version");
    if (sectionVersion.compare(base) <= 0) {
      shippedSections.push(match[0].trim());
    }
  }

  const preparedSection = renderReleaseSection({ version, date, commits }).trim();
  return `${[header, preparedSection, ...shippedSections].join("\n\n")}\n`;
}

export function assertPreparedChangelog({ contents, baseVersion, version, commits }) {
  const escapedVersion = version.replaceAll(".", "\\.");
  const heading = new RegExp(
    `^## \\[${escapedVersion}\\] - (?<date>\\d{4}-\\d{2}-\\d{2})$`,
    "mu",
  );
  const preparedDate = heading.exec(contents)?.groups?.date;
  if (!preparedDate) {
    throw new Error(`CHANGELOG.md has no release section for ${version}.`);
  }

  const expected = updateChangelog({
    contents,
    baseVersion,
    version,
    date: preparedDate,
    commits,
  });
  if (contents !== expected) {
    throw new Error(
      `CHANGELOG.md does not exactly match the Conventional Commits in release ${version}.`,
    );
  }
}

function git(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function readJsonAtRef(ref, path) {
  try {
    return JSON.parse(git(["show", `${ref}:${path}`]));
  } catch (error) {
    throw new Error(`Unable to read ${path} at ${ref}: ${error.message}`);
  }
}

function collectCommits(baseRef, headRef) {
  const log = git([
    "log",
    "--no-merges",
    "--reverse",
    "--format=%H%x1f%s%x1f%b%x1e",
    `${baseRef}..${headRef}`,
  ]);
  if (!log) return [];

  return log
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, subject, ...body] = record.split("\x1f");
      return { sha, subject, body: body.join("\x1f").trim() };
    })
    .filter((commit) => !RELEASE_COMMIT_PATTERN.test(commit.subject));
}

function buildPlan(baseRef, headRef, override) {
  const basePackage = readJsonAtRef(baseRef, "package.json");
  const commits = collectCommits(baseRef, headRef);
  const calculation = calculateNextVersion(basePackage.version, commits, override);

  return {
    ...calculation,
    baseVersion: String(basePackage.version),
    tag: `v${calculation.version}`,
    archive: `release/bookmark-x-${calculation.version}.zip`,
    commits: normalizeCommits(commits),
  };
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${error.message}`);
  }
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeGithubOutput(path, plan) {
  if (!path) return;
  const output = [
    `version=${plan.version}`,
    `tag=${plan.tag}`,
    `archive=${plan.archive}`,
    `bump=${plan.bump}`,
  ].join("\n");
  await appendFile(path, `${output}\n`, "utf8");
}

async function prepare(options) {
  const plan = buildPlan(options.baseRef, options.headRef, options.bump);
  const [packageJson, manifest] = await Promise.all([
    readJson(PACKAGE_PATH, "package.json"),
    readJson(MANIFEST_PATH, "public/manifest.json"),
  ]);
  const changelog = await readFile(CHANGELOG_PATH, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const preparedDatePattern = new RegExp(
    `^## \\[${plan.version.replaceAll(".", "\\.")}\\] - (?<date>\\d{4}-\\d{2}-\\d{2})$`,
    "mu",
  );
  const existingPreparedDate = preparedDatePattern.exec(changelog)?.groups?.date;
  const date =
    options.date || existingPreparedDate || new Date().toISOString().slice(0, 10);

  await Promise.all([
    writeJson(PACKAGE_PATH, { ...packageJson, version: plan.version }),
    writeJson(MANIFEST_PATH, { ...manifest, version: plan.version }),
    writeFile(
      CHANGELOG_PATH,
      updateChangelog({
        contents: changelog,
        baseVersion: plan.baseVersion,
        version: plan.version,
        date,
        commits: plan.commits,
      }),
      "utf8",
    ),
    writeGithubOutput(options.githubOutput, plan),
  ]);

  return plan;
}

async function verify(options) {
  const plan = buildPlan(options.baseRef, options.headRef, options.bump);
  const [packageJson, manifest, changelog] = await Promise.all([
    readJson(PACKAGE_PATH, "package.json"),
    readJson(MANIFEST_PATH, "public/manifest.json"),
    readFile(CHANGELOG_PATH, "utf8"),
  ]);

  if (packageJson.version !== plan.version || manifest.version !== plan.version) {
    throw new Error(
      `Prepared version must be ${plan.version}; package.json is ${packageJson.version} and manifest is ${manifest.version}.`,
    );
  }
  assertPreparedChangelog({
    contents: changelog,
    baseVersion: plan.baseVersion,
    version: plan.version,
    commits: plan.commits,
  });

  if (options.requireArchive) {
    await readFile(DOWNLOAD_PATH).catch((error) => {
      throw new Error(`Stable release archive is missing: ${error.message}`);
    });
    await readFile(resolve(ROOT, plan.archive)).catch((error) => {
      throw new Error(`Versioned release archive is missing: ${error.message}`);
    });
  }

  return plan;
}

function parseOptions(argv) {
  const command = argv[0];
  if (!new Set(["plan", "prepare", "verify"]).has(command)) {
    throw new Error("Use plan, prepare, or verify.");
  }

  const options = {
    command,
    baseRef: "origin/main",
    headRef: "HEAD",
    bump: "auto",
    githubOutput: "",
    date: "",
    requireArchive: false,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--require-archive") {
      options.requireArchive = true;
      continue;
    }
    const key = {
      "--base-ref": "baseRef",
      "--head-ref": "headRef",
      "--bump": "bump",
      "--github-output": "githubOutput",
      "--date": "date",
    }[argument];
    if (!key || !argv[index + 1]) {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
    options[key] = argv[index + 1];
    index += 1;
  }

  return options;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const plan =
    options.command === "prepare"
      ? await prepare(options)
      : options.command === "verify"
        ? await verify(options)
        : buildPlan(options.baseRef, options.headRef, options.bump);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    console.error(`Release train failed: ${error.message}`);
    process.exitCode = 1;
  });
}
