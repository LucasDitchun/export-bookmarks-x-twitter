import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const rootDirectory = resolve(import.meta.dirname, "..");
const packageJsonPath = resolve(rootDirectory, "package.json");
const manifestPath = resolve(rootDirectory, "public", "manifest.json");
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const maximumChromeVersionComponent = 65_535;

function fail(message) {
  throw new Error(message);
}

function parseVersion(value, label) {
  const match = versionPattern.exec(value);
  if (!match) {
    fail(`${label} must use MAJOR.MINOR.PATCH with non-negative integers.`);
  }

  const components = match.slice(1).map(Number);
  if (components.some((component) => component > maximumChromeVersionComponent)) {
    fail(
      `${label} components must not exceed ${maximumChromeVersionComponent}, as required by Chrome.`,
    );
  }

  return components;
}

function compareVersions(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index];
    }
  }

  return 0;
}

function resolveTargetVersion(specification, currentVersion) {
  const current = parseVersion(currentVersion, "Current package version");
  const normalizedSpecification = specification.trim();

  if (["patch", "minor", "major"].includes(normalizedSpecification)) {
    const [major, minor, patch] = current;
    const next =
      normalizedSpecification === "major"
        ? [major + 1, 0, 0]
        : normalizedSpecification === "minor"
          ? [major, minor + 1, 0]
          : [major, minor, patch + 1];

    parseVersion(next.join("."), "Next version");
    return next.join(".");
  }

  const explicit = parseVersion(normalizedSpecification, "Explicit version");
  if (compareVersions(explicit, current) <= 0) {
    fail(
      `Explicit version must be greater than the current version (${currentVersion}).`,
    );
  }

  return explicit.join(".");
}

async function readJson(filePath, label) {
  let source;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    fail(`Unable to read ${label}: ${error.message}`);
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

async function main() {
  const specification = process.argv[2];
  if (!specification) {
    fail("Pass patch, minor, major, or an explicit MAJOR.MINOR.PATCH version.");
  }

  const [packageJson, manifest] = await Promise.all([
    readJson(packageJsonPath, "package.json"),
    readJson(manifestPath, "public/manifest.json"),
  ]);

  parseVersion(String(packageJson.version), "package.json version");
  parseVersion(String(manifest.version), "public/manifest.json version");

  if (packageJson.version !== manifest.version) {
    fail(
      `Version mismatch: package.json is ${String(packageJson.version)}, while public/manifest.json is ${String(manifest.version)}.`,
    );
  }

  const targetVersion = resolveTargetVersion(specification, packageJson.version);
  const updatedPackageJson = { ...packageJson, version: targetVersion };
  const updatedManifest = { ...manifest, version: targetVersion };

  await Promise.all([
    writeFile(
      packageJsonPath,
      `${JSON.stringify(updatedPackageJson, null, 2)}\n`,
      "utf8",
    ),
    writeFile(manifestPath, `${JSON.stringify(updatedManifest, null, 2)}\n`, "utf8"),
  ]);

  process.stdout.write(`${targetVersion}\n`);
}

main().catch((error) => {
  console.error(`Version update failed: ${error.message}`);
  process.exitCode = 1;
});
