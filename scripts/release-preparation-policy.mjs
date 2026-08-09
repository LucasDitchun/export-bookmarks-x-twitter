import { execFileSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const ALLOWED_RELEASE_PREPARATION_PATHS = Object.freeze([
  "CHANGELOG.md",
  "download/bookmark-x.zip",
  "package.json",
  "pnpm-lock.yaml",
  "public/manifest.json",
]);

const REQUIRED_RELEASE_PREPARATION_PATHS = Object.freeze([
  "CHANGELOG.md",
  "download/bookmark-x.zip",
]);

export function assertReleasePreparationChanges(changes) {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new Error("Release preparation did not change any files.");
  }

  const allowedPaths = new Set(ALLOWED_RELEASE_PREPARATION_PATHS);
  const changedPaths = new Set();
  for (const change of changes) {
    if (change?.status !== "A" && change?.status !== "M") {
      throw new Error(
        `Release preparation may only add or modify files: ${String(change?.path)} (${String(change?.status)}).`,
      );
    }
    if (!allowedPaths.has(change.path)) {
      throw new Error(`Release preparation changed forbidden path: ${change.path}.`);
    }
    if (changedPaths.has(change.path)) {
      throw new Error(`Release preparation reports duplicate path: ${change.path}.`);
    }
    changedPaths.add(change.path);
  }

  for (const requiredPath of REQUIRED_RELEASE_PREPARATION_PATHS) {
    if (!changedPaths.has(requiredPath)) {
      throw new Error(`Release preparation is missing required path: ${requiredPath}`);
    }
  }
}

function parseNameStatus(output) {
  const fields = output.split("\0");
  if (fields.at(-1) === "") {
    fields.pop();
  }
  const changes = [];
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index];
    const path = fields[index + 1];
    if (!status || !path) {
      throw new Error("Could not parse the release preparation diff.");
    }
    changes.push({ path, status });
  }
  return changes;
}

export function readReleasePreparationArguments(arguments_) {
  const options = { baseRef: "origin/develop", headRef: "HEAD" };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--") {
      continue;
    } else if (argument === "--base-ref") {
      options.baseRef = arguments_[index + 1];
      index += 1;
    } else if (argument === "--head-ref") {
      options.headRef = arguments_[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!options.baseRef || !options.headRef) {
    throw new Error("Both --base-ref and --head-ref require values.");
  }
  return options;
}

function main() {
  const { baseRef, headRef } = readReleasePreparationArguments(process.argv.slice(2));
  const output = execFileSync(
    "git",
    ["diff", "--name-status", "-z", baseRef, headRef, "--"],
    { encoding: "utf8" },
  );
  const changes = parseNameStatus(output);
  assertReleasePreparationChanges(changes);
  console.log(
    `Release preparation changes only ${changes.length} approved artifact paths.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
