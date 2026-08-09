import { createWriteStream } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import process from "node:process";
import { ZipArchive } from "archiver";

import {
  EXPECTED_MANIFEST_PERMISSIONS,
  validateExactStringArray,
} from "./package-policy.mjs";

const rootDirectory = resolve(import.meta.dirname, "..");
const distDirectory = resolve(rootDirectory, "dist");
const releaseDirectory = resolve(rootDirectory, "release");
const downloadDirectory = resolve(rootDirectory, "download");
const packageJsonPath = resolve(rootDirectory, "package.json");
const supportedLocales = ["en", "pt_BR", "ja", "es", "zh_CN", "de", "fr", "it"];

function fail(message) {
  throw new Error(message);
}

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFiles(absolutePath, relativePath)));
    } else if (entry.isFile()) {
      files.push({ absolutePath, relativePath });
    }
  }

  return files;
}

async function validateBuild(packageVersion) {
  try {
    if (!(await stat(distDirectory)).isDirectory()) {
      fail("dist exists but is not a directory.");
    }
  } catch (error) {
    if (error?.code === "ENOENT") {
      fail("dist is missing. Run pnpm build before pnpm package.");
    }
    throw error;
  }

  await copyFile(resolve(rootDirectory, "LICENSE"), resolve(distDirectory, "LICENSE"));

  const requiredFiles = [
    "LICENSE",
    "manifest.json",
    "popup.html",
    "service-worker.js",
    "content-script.js",
  ];
  for (const fileName of requiredFiles) {
    try {
      await access(resolve(distDirectory, fileName));
    } catch {
      fail(`dist/${fileName} is missing. Run a complete production build.`);
    }
  }

  const manifestText = await readFile(resolve(distDirectory, "manifest.json"), "utf8");
  const manifest = JSON.parse(manifestText);

  if (manifest.manifest_version !== 3) {
    fail("dist/manifest.json must use Manifest V3.");
  }
  if (manifest.version !== packageVersion) {
    fail(
      `Manifest version ${String(manifest.version)} does not match package version ${packageVersion}.`,
    );
  }
  if (manifest.background?.service_worker !== "service-worker.js") {
    fail("Manifest background.service_worker must be service-worker.js.");
  }
  if (manifest.background?.type !== "module") {
    fail("Manifest background.type must be module.");
  }
  if (manifest.action?.default_popup !== "popup.html") {
    fail("Manifest action.default_popup must be popup.html.");
  }
  if (manifest.default_locale !== "en") {
    fail("Manifest default_locale must be en.");
  }

  validateExactStringArray(
    manifest.permissions,
    EXPECTED_MANIFEST_PERMISSIONS,
    "permissions",
  );
  if (Object.hasOwn(manifest, "host_permissions")) {
    fail("Manifest must not declare broad host_permissions.");
  }

  const forbiddenManifestKeys = [
    "externally_connectable",
    "optional_host_permissions",
    "optional_permissions",
    "web_accessible_resources",
  ];
  for (const key of forbiddenManifestKeys) {
    if (Object.hasOwn(manifest, key)) {
      fail(`Manifest must not declare ${key}.`);
    }
  }

  if (
    !Array.isArray(manifest.content_scripts) ||
    manifest.content_scripts.length !== 1
  ) {
    fail("Manifest must declare exactly one restricted content script.");
  }
  const [contentScript] = manifest.content_scripts;
  validateExactStringArray(
    contentScript?.matches,
    ["https://www.x.com/i/bookmarks*", "https://x.com/i/bookmarks*"],
    "content_scripts[0].matches",
  );
  validateExactStringArray(
    contentScript?.js,
    ["content-script.js"],
    "content_scripts[0].js",
  );
  if (contentScript?.run_at !== "document_idle") {
    fail("Manifest content script must run at document_idle.");
  }

  const extensionPagesPolicy = manifest.content_security_policy?.extension_pages;
  if (
    typeof extensionPagesPolicy === "string" &&
    /script-src[^;]*(?:https?:|data:)/iu.test(extensionPagesPolicy)
  ) {
    fail("Manifest content security policy permits remote executable code.");
  }

  const files = await listFiles(distDirectory);
  const filePaths = new Set(files.map((file) => file.relativePath));
  const forbiddenExtensions = new Set([".map", ".pem", ".key"]);
  const forbiddenNames = new Set([".env", ".env.local"]);
  const referencedManifestFiles = [
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
    ...supportedLocales.map((locale) => `_locales/${locale}/messages.json`),
    "icons/icon.svg",
  ];

  for (const fileName of referencedManifestFiles) {
    if (typeof fileName !== "string" || !filePaths.has(fileName)) {
      fail(`Manifest-referenced release file is missing: dist/${String(fileName)}`);
    }
  }

  for (const file of files) {
    const lowerPath = file.relativePath.toLowerCase();
    const dotIndex = lowerPath.lastIndexOf(".");
    const extension = dotIndex >= 0 ? lowerPath.slice(dotIndex) : "";

    if (
      forbiddenExtensions.has(extension) ||
      forbiddenNames.has(lowerPath) ||
      lowerPath.startsWith(".env") ||
      lowerPath.includes("/.env")
    ) {
      fail(`Forbidden release file: dist/${file.relativePath}`);
    }

    if (extension === ".html") {
      const html = await readFile(file.absolutePath, "utf8");
      if (/<script\b[^>]*\bsrc\s*=\s*["']https?:\/\//iu.test(html)) {
        fail(`Remote script found in dist/${file.relativePath}.`);
      }
    }

    if (extension === ".js") {
      const javascript = await readFile(file.absolutePath, "utf8");
      if (
        /(?:\bimport\s*\(|\bfrom\s*|\bimportScripts\s*\()\s*["']https?:\/\//iu.test(
          javascript,
        )
      ) {
        fail(`Remote executable import found in dist/${file.relativePath}.`);
      }
    }
  }

  return files.length;
}

async function createArchive(outputPath) {
  await mkdir(releaseDirectory, { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;

  const archive = new ZipArchive({ zlib: { level: 9 } });
  const output = createWriteStream(temporaryPath, { flags: "wx" });
  const completion = pipeline(archive, output);

  try {
    archive.directory(distDirectory, false);
    await Promise.all([archive.finalize(), completion]);
    await rename(temporaryPath, outputPath);
  } catch (error) {
    archive.abort();
    output.destroy();
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function main() {
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const fileCount = await validateBuild(packageJson.version);
  const outputPath = resolve(
    releaseDirectory,
    `${packageJson.name}-${packageJson.version}.zip`,
  );

  await createArchive(outputPath);
  await mkdir(downloadDirectory, { recursive: true });
  const downloadPath = resolve(downloadDirectory, "bookmark-x.zip");
  await copyFile(outputPath, downloadPath);

  console.log(
    `Created ${outputPath} and ${downloadPath} from ${fileCount} validated extension files.`,
  );
}

main().catch((error) => {
  console.error(`Package failed: ${error.message}`);
  process.exitCode = 1;
});
