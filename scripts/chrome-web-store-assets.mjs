import { spawn } from "node:child_process";
import {
  access,
  copyFile,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const CHROME_WEB_STORE_ASSET_DIRECTORY = "docs/chrome-web-store/assets";

export const CHROME_WEB_STORE_ASSET_FILENAMES = Object.freeze({
  icon: "icon-128.png",
  screenshots: Object.freeze([
    "screenshot-01-search-library.png",
    "screenshot-02-organize-folders-tags.png",
    "screenshot-03-note-folder-tags.png",
    "screenshot-04-capture-recent.png",
    "screenshot-05-export-private.png",
  ]),
  smallPromo: "small-promo-tile.png",
  marquee: "marquee-promo-tile.png",
});

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const ICON_SOURCE_PATH = resolve(PROJECT_ROOT, "public/icons/icon-128.png");
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function dataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function assertPngFile(directory, filename, expectedWidth, expectedHeight) {
  const path = resolve(directory, filename);
  const { width, height } = readPngSize(await readFile(path));
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(
      `${filename} must be ${expectedWidth}x${expectedHeight}, received ${width}x${height}.`,
    );
  }
  return { filename, width, height };
}

export function readPngSize(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError("readPngSize expects a Node.js Buffer.");
  }
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Expected a PNG file with a readable IHDR header.");
  }
  const chunkType = buffer.subarray(12, 16).toString("ascii");
  if (chunkType !== "IHDR") {
    throw new Error("Expected the first PNG chunk to be IHDR.");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

export async function validateCuratedChromeWebStoreScreenshots(directory) {
  const screenshots = (await readdir(directory))
    .filter((filename) => filename.toLowerCase().endsWith(".png"))
    .map((filename) => basename(filename))
    .filter((filename) => filename.startsWith("screenshot-"))
    .sort((left, right) => left.localeCompare(right, "en"));
  const expected = [...CHROME_WEB_STORE_ASSET_FILENAMES.screenshots];

  if (
    screenshots.length !== expected.length ||
    screenshots.some((filename, index) => filename !== expected[index])
  ) {
    throw new Error(
      `Chrome Web Store assets must contain exactly these five curated screenshots: ${expected.join(
        ", ",
      )}.`,
    );
  }

  return Promise.all(
    expected.map((filename) => assertPngFile(directory, filename, 1280, 800)),
  );
}

export async function validateChromeWebStoreAssets(directory) {
  const screenshots = await validateCuratedChromeWebStoreScreenshots(directory);
  return {
    icon: await assertPngFile(
      directory,
      CHROME_WEB_STORE_ASSET_FILENAMES.icon,
      128,
      128,
    ),
    screenshots,
    smallPromo: await assertPngFile(
      directory,
      CHROME_WEB_STORE_ASSET_FILENAMES.smallPromo,
      440,
      280,
    ),
    marquee: await assertPngFile(
      directory,
      CHROME_WEB_STORE_ASSET_FILENAMES.marquee,
      1400,
      560,
    ),
  };
}

function parseArguments(args) {
  return { validateOnly: args.includes("--validate-only") };
}

async function findChromeBinary() {
  const candidates = [
    process.env.CHROME_BIN,
    "/snap/chromium/current/usr/lib/chromium-browser/chrome",
    ...[
      "chromium",
      "chromium-browser",
      "google-chrome-for-testing",
      "google-chrome",
    ].flatMap((name) =>
      (process.env.PATH ?? "")
        .split(delimiter)
        .filter(Boolean)
        .map((directory) => resolve(directory, name)),
    ),
  ];
  for (const candidate of new Set(candidates.filter(Boolean))) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next browser candidate.
    }
  }
  throw new Error("No compatible browser found. Set CHROME_BIN to Chromium or Chrome.");
}

function spawnCommand(command, args, options = {}) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("error", rejectCommand);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolveCommand();
        return;
      }
      rejectCommand(
        new Error(
          `${command} ${args.join(" ")} exited with ${code ?? "null"}${
            signal ? ` (${signal})` : ""
          }.`,
        ),
      );
    });
  });
}

async function renderHtmlScene({ chromeBinary, html, outputPath, width, height }) {
  const workingDirectory = await mkdtemp(join(tmpdir(), "bookmark-x-cws-scene-"));
  try {
    const scenePath = resolve(workingDirectory, "scene.html");
    await writeFile(scenePath, html, "utf8");
    await spawnCommand(chromeBinary, [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      `--window-size=${width},${height}`,
      `--screenshot=${outputPath}`,
      "--run-all-compositor-stages-before-draw",
      "--virtual-time-budget=3000",
      pathToFileURL(scenePath).href,
    ]);
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

function shellHtml(body, { width, height }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      :root { color-scheme: light; font-family: Verdana, Geneva, Tahoma, sans-serif; }
      * { box-sizing: border-box; }
      html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: #0c0d0b; }
      body, .canvas { position: relative; width: 100%; height: 100%; }
      .frame { position: absolute; overflow: hidden; border: 2px solid #d9ff45; border-radius: 18px; background: #fffef5; }
      .frame img { display: block; width: 100%; height: 100%; object-fit: cover; background: #fffef5; }
      .brand { position: absolute; display: inline-flex; align-items: center; gap: 11px; }
      .brand img { width: 40px; height: 40px; }
      .brand span { font-size: 17px; font-weight: 700; letter-spacing: -.02em; color: #fffef5; }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}

function smallPromoScene({ icon }) {
  return shellHtml(
    `<main class="canvas">
      <div style="position:absolute;inset:0;background:#0c0d0b"></div>
      <div style="position:absolute;right:0;top:0;width:28px;height:100%;background:#d9ff45"></div>
      <div class="brand" style="left:28px;top:24px"><img alt="" src="${icon}"><span style="font-size:20px">Bookmark X</span></div>
      <p style="position:absolute;left:28px;bottom:28px;margin:0;color:#fffef5;font-size:38px;font-weight:700;line-height:1;letter-spacing:-.055em">Find what<br>you saved<span style="color:#d9ff45">.</span></p>
    </main>`,
    { width: 440, height: 280 },
  );
}

function marqueeScene({ icon, search }) {
  return shellHtml(
    `<main class="canvas">
      <div style="position:absolute;inset:0;background:#0c0d0b"></div>
      <div style="position:absolute;left:0;top:0;width:100%;height:14px;background:#d9ff45"></div>
      <div class="brand" style="left:54px;top:48px"><img alt="" src="${icon}"><span style="font-size:22px">Bookmark X</span></div>
      <div style="position:absolute;left:54px;bottom:52px;width:430px;color:#fffef5">
        <h1 style="margin:0 0 22px;font-size:68px;line-height:.94;letter-spacing:-.07em">Find what<br>you saved<span style="color:#d9ff45">.</span></h1>
        <p style="margin:0;color:#d9ff45;font:700 16px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.1em">LOCAL · SEARCHABLE · YOURS</p>
      </div>
      <section class="frame" style="left:535px;top:38px;width:830px;height:486px"><img alt="" src="${search}"></section>
    </main>`,
    { width: 1400, height: 560 },
  );
}

async function readCuratedScreenshots(directory) {
  return Promise.all(
    CHROME_WEB_STORE_ASSET_FILENAMES.screenshots.map((filename) =>
      readFile(resolve(directory, filename)),
    ),
  );
}

function assertCuratedScreenshotsUnchanged(before, after) {
  for (const [
    index,
    filename,
  ] of CHROME_WEB_STORE_ASSET_FILENAMES.screenshots.entries()) {
    if (!before[index].equals(after[index])) {
      throw new Error(
        `Asset generation must not modify curated screenshot ${filename}.`,
      );
    }
  }
}

export async function generateChromeWebStoreAssets(
  directory = resolve(PROJECT_ROOT, CHROME_WEB_STORE_ASSET_DIRECTORY),
  {
    chromeBinary,
    iconSourcePath = ICON_SOURCE_PATH,
    renderScene = renderHtmlScene,
  } = {},
) {
  await mkdir(directory, { recursive: true });
  await validateCuratedChromeWebStoreScreenshots(directory);
  const screenshotsBefore = await readCuratedScreenshots(directory);
  const resolvedChromeBinary = chromeBinary ?? (await findChromeBinary());

  await copyFile(
    iconSourcePath,
    resolve(directory, CHROME_WEB_STORE_ASSET_FILENAMES.icon),
  );
  const icon = dataUrl(await readFile(iconSourcePath));
  await renderScene({
    chromeBinary: resolvedChromeBinary,
    html: smallPromoScene({ icon }),
    outputPath: resolve(directory, CHROME_WEB_STORE_ASSET_FILENAMES.smallPromo),
    width: 440,
    height: 280,
  });
  await renderScene({
    chromeBinary: resolvedChromeBinary,
    html: marqueeScene({ icon, search: dataUrl(screenshotsBefore[0]) }),
    outputPath: resolve(directory, CHROME_WEB_STORE_ASSET_FILENAMES.marquee),
    width: 1400,
    height: 560,
  });

  assertCuratedScreenshotsUnchanged(
    screenshotsBefore,
    await readCuratedScreenshots(directory),
  );
  return validateChromeWebStoreAssets(directory);
}

function summaryLines(summary, directory) {
  return [
    `Chrome Web Store assets validated in ${directory}`,
    `- icon: ${summary.icon.filename} (${summary.icon.width}x${summary.icon.height})`,
    ...summary.screenshots.map(
      (file) => `- curated screenshot: ${file.filename} (${file.width}x${file.height})`,
    ),
    `- small promo: ${summary.smallPromo.filename} (${summary.smallPromo.width}x${summary.smallPromo.height})`,
    `- marquee: ${summary.marquee.filename} (${summary.marquee.width}x${summary.marquee.height})`,
  ];
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const directory = resolve(PROJECT_ROOT, CHROME_WEB_STORE_ASSET_DIRECTORY);
  const summary = options.validateOnly
    ? await validateChromeWebStoreAssets(directory)
    : await generateChromeWebStoreAssets(directory);
  console.log(summaryLines(summary, directory).join("\n"));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
