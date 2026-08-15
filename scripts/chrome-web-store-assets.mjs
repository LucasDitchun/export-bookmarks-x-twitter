import { spawn } from "node:child_process";
import { once } from "node:events";
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

import {
  extensionDebugArguments,
  loadUnpackedExtension,
  navigateToExtensionContext,
} from "./chrome-smoke-readiness.mjs";

export const CHROME_WEB_STORE_ASSET_DIRECTORY = "docs/chrome-web-store/assets";

export const CHROME_WEB_STORE_ASSET_FILENAMES = Object.freeze({
  icon: "icon-128.png",
  screenshots: Object.freeze([
    "screenshot-01-dashboard-overview.png",
    "screenshot-02-library-inbox.png",
    "screenshot-03-bookmark-detail-note-tags.png",
    "screenshot-04-library-organization.png",
    "screenshot-05-library-archived-search.png",
  ]),
  smallPromo: "small-promo-tile.png",
  marquee: "marquee-promo-tile.png",
});

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const DIST_DIRECTORY = resolve(PROJECT_ROOT, "dist");
const ICON_SOURCE_PATH = resolve(PROJECT_ROOT, "public/icons/icon-128.png");
const STARTUP_TIMEOUT_MS = 20_000;
const SCREENSHOT_SOURCES = Object.freeze({
  homeDashboard: "home-dashboard.png",
  libraryInbox: "library-inbox.png",
  detailOrganizedBookmark: "detail-organized-bookmark.png",
  libraryOrganization: "library-organization.png",
  libraryArchivedSearch: "library-archived-search.png",
});
export const CHROME_WEB_STORE_SCREENSHOT_SCENES = Object.freeze([
  Object.freeze({
    filename: CHROME_WEB_STORE_ASSET_FILENAMES.screenshots[0],
    checkpoint: "home-dashboard",
  }),
  Object.freeze({
    filename: CHROME_WEB_STORE_ASSET_FILENAMES.screenshots[1],
    checkpoint: "library-inbox",
  }),
  Object.freeze({
    filename: CHROME_WEB_STORE_ASSET_FILENAMES.screenshots[2],
    checkpoint: "detail-organized-bookmark",
  }),
  Object.freeze({
    filename: CHROME_WEB_STORE_ASSET_FILENAMES.screenshots[3],
    checkpoint: "library-organization",
  }),
  Object.freeze({
    filename: CHROME_WEB_STORE_ASSET_FILENAMES.screenshots[4],
    checkpoint: "library-archived-search",
  }),
]);
export const CHROME_WEB_STORE_LISTING_FIXTURE = Object.freeze({
  bookmarks: Object.freeze([
    Object.freeze({
      id: "111",
      text: "Offline reading checklist for a long train ride.",
      url: "https://x.com/bookmarkx/status/111",
      author: Object.freeze({
        id: "author-111",
        username: "bookmarkx",
        name: "Bookmark X Notes",
      }),
      postCreatedAt: "2026-08-02T09:00:00.000Z",
      media: Object.freeze({ images: [], videos: [] }),
      note: "",
      folderId: null,
      tagIds: [],
      firstSavedAt: "2026-08-10T09:00:00.000Z",
      lastSeenAt: "2026-08-10T09:00:00.000Z",
      archivedAt: null,
      metadataUpdatedAt: "2026-08-10T09:00:00.000Z",
      status: "current",
    }),
    Object.freeze({
      id: "222",
      text: "How to keep a local research workflow organized across devices.",
      url: "https://x.com/bookmarkx/status/222",
      author: Object.freeze({
        id: "author-222",
        username: "localgraphs",
        name: "Local Graphs",
      }),
      postCreatedAt: "2026-08-03T14:30:00.000Z",
      media: Object.freeze({ images: [], videos: [] }),
      note: "Pull quotes into the next reading review and compare with export filters.",
      folderId: "folder-ai",
      tagIds: ["tag-research", "tag-workflow"],
      firstSavedAt: "2026-08-11T14:30:00.000Z",
      lastSeenAt: "2026-08-11T14:30:00.000Z",
      archivedAt: null,
      metadataUpdatedAt: "2026-08-11T14:30:00.000Z",
      status: "current",
    }),
    Object.freeze({
      id: "333",
      text: "Night photography field notes for tripod setup and manual focus.",
      url: "https://x.com/bookmarkx/status/333",
      author: Object.freeze({
        id: "author-333",
        username: "midnightmanual",
        name: "Midnight Manual",
      }),
      postCreatedAt: "2026-08-04T20:15:00.000Z",
      media: Object.freeze({ images: [], videos: [] }),
      note: "Archive after copying the lens checklist into the travel pack.",
      folderId: "folder-field-notes",
      tagIds: ["tag-photography"],
      firstSavedAt: "2026-08-12T20:15:00.000Z",
      lastSeenAt: "2026-08-12T20:15:00.000Z",
      archivedAt: "2026-08-13T08:45:00.000Z",
      metadataUpdatedAt: "2026-08-13T08:45:00.000Z",
      status: "archived",
    }),
  ]),
  folders: Object.freeze([
    Object.freeze({ id: "folder-reading", name: "Reading", parentId: null }),
    Object.freeze({ id: "folder-ai", name: "AI", parentId: "folder-reading" }),
    Object.freeze({
      id: "folder-field-notes",
      name: "Field Notes",
      parentId: null,
    }),
  ]),
  tags: Object.freeze([
    Object.freeze({
      id: "tag-research",
      name: "Research",
      normalizedName: "research",
    }),
    Object.freeze({
      id: "tag-workflow",
      name: "Workflow",
      normalizedName: "workflow",
    }),
    Object.freeze({
      id: "tag-photography",
      name: "Photography",
      normalizedName: "photography",
    }),
  ]),
  archive: Object.freeze({
    lastSuccessfulSyncAt: "2026-08-14T12:00:00.000Z",
  }),
});
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function dataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function matchesExpectedScreenshots(actual) {
  return (
    actual.length >= 1 &&
    actual.length <= 5 &&
    actual.every(
      (filename, index) =>
        filename === CHROME_WEB_STORE_ASSET_FILENAMES.screenshots[index],
    )
  );
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

export async function validateChromeWebStoreAssets(directory) {
  const files = (await readdir(directory))
    .filter((filename) => filename.toLowerCase().endsWith(".png"))
    .map((filename) => basename(filename))
    .sort();
  const screenshots = files
    .filter((filename) => filename.startsWith("screenshot-"))
    .sort((left, right) => left.localeCompare(right, "en"));
  if (!matchesExpectedScreenshots(screenshots)) {
    throw new Error(
      "Chrome Web Store assets must contain between 1 and 5 screenshots with the expected filenames.",
    );
  }

  return {
    icon: await assertPngFile(
      directory,
      CHROME_WEB_STORE_ASSET_FILENAMES.icon,
      128,
      128,
    ),
    screenshots: await Promise.all(
      screenshots.map((filename) => assertPngFile(directory, filename, 1280, 800)),
    ),
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
  return {
    validateOnly: args.includes("--validate-only"),
  };
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
    const child = spawn(command, args, {
      stdio: "inherit",
      ...options,
    });
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

async function waitForDevToolsPort(profileDirectory) {
  const activePortFile = resolve(profileDirectory, "DevToolsActivePort");
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const [port] = (await readFile(activePortFile, "utf8")).split("\n");
      if (port) return port;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("Chrome DevTools did not become available.");
}

async function openTarget(port, url) {
  const response = await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,
    { method: "PUT" },
  );
  if (!response.ok) {
    throw new Error(`Chrome could not open a target (${response.status}).`);
  }
  return response.json();
}

async function connectDevTools(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolveConnection, rejectConnection) => {
    socket.addEventListener("open", resolveConnection, { once: true });
    socket.addEventListener(
      "error",
      () => rejectConnection(new Error("Could not connect to Chrome DevTools.")),
      { once: true },
    );
  });
  let commandId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const command = pending.get(message.id);
    if (!command) return;
    pending.delete(message.id);
    if (message.error) command.reject(new Error(message.error.message));
    else command.resolve(message.result);
  });
  return {
    close: () => socket.close(),
    send(method, params = {}) {
      commandId += 1;
      return new Promise((resolveCommand, rejectCommand) => {
        pending.set(commandId, {
          resolve: resolveCommand,
          reject: rejectCommand,
        });
        socket.send(JSON.stringify({ id: commandId, method, params }));
      });
    },
  };
}

async function captureVisualCheckpoint(devTools, filename, viewport, directory) {
  await mkdir(directory, { recursive: true });
  await devTools.send("Page.enable");
  await devTools.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await devTools.send("Runtime.evaluate", {
    expression: String.raw`(async () => {
      await document.fonts.ready;
      await new Promise((resolve) => setTimeout(resolve, 300));
    })()`,
    awaitPromise: true,
  });
  const screenshot = await devTools.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    fromSurface: true,
  });
  await writeFile(resolve(directory, filename), Buffer.from(screenshot.data, "base64"));
}

function waitForConditionExpression(predicate, failureMessage) {
  return String.raw`(async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (${predicate}) return true;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(${JSON.stringify(failureMessage)});
  })()`;
}

async function waitForCondition(devTools, predicate, failureMessage) {
  await devTools.send("Runtime.evaluate", {
    expression: waitForConditionExpression(predicate, failureMessage),
    awaitPromise: true,
  });
}

async function evaluate(devTools, expression) {
  return devTools.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
  });
}

function listingSeedScenario() {
  return String.raw`(async () => {
    const fixture = ${JSON.stringify(CHROME_WEB_STORE_LISTING_FIXTURE)};
    await chrome.storage.local.set({
      firstUseDisclosure: {
        version: 1,
        acceptedAt: "2026-08-15T02:00:00.000Z",
      },
    });
    const exported = await chrome.runtime.sendMessage({ type: "EXPORT_BACKUP" });
    if (!exported?.ok) throw new Error("Could not export the baseline backup.");
    const backup = JSON.parse(exported.data.content);
    backup.data.bookmarks = fixture.bookmarks;
    backup.data.folders = fixture.folders;
    backup.data.tags = fixture.tags;
    backup.data.archive = fixture.archive;
    backup.data.settings.uiLocale = "en";
    if (backup.data.settings.extension?.settings?.search) {
      backup.data.settings.extension.settings.search.filterAsYouType = true;
    }
    const restored = await chrome.runtime.sendMessage({
      type: "RESTORE_BACKUP",
      payload: { content: JSON.stringify(backup), mode: "replace", confirmed: true },
    });
    if (!restored?.ok) throw new Error("Could not restore the listing fixture.");
    return restored.data;
  })()`;
}

async function captureExtensionCheckpoints(checkpointDirectory) {
  const chromeBinary = await findChromeBinary();
  const profileDirectory = await mkdtemp(join(PROJECT_ROOT, "chrome-store-profile-"));
  const chromeProcess = spawn(
    chromeBinary,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
      "--no-default-browser-check",
      ...extensionDebugArguments(),
      `--user-data-dir=${profileDirectory}`,
      "--remote-debugging-port=0",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let browserDevTools;
  let sidePanelDevTools;
  try {
    const port = await waitForDevToolsPort(profileDirectory);
    const browserTarget = await fetch(`http://127.0.0.1:${port}/json/version`).then(
      (response) => response.json(),
    );
    browserDevTools = await connectDevTools(browserTarget.webSocketDebuggerUrl);
    const extensionId = await loadUnpackedExtension(browserDevTools, DIST_DIRECTORY);

    const sidePanelUrl = `chrome-extension://${extensionId}/popup.html?surface=side-panel`;
    const sidePanelTarget = await openTarget(port, "about:blank");
    sidePanelDevTools = await connectDevTools(sidePanelTarget.webSocketDebuggerUrl);
    await navigateToExtensionContext(sidePanelDevTools, sidePanelUrl);
    await waitForCondition(
      sidePanelDevTools,
      String.raw`document.documentElement?.dataset.surface === "side-panel"`,
      "Side panel surface did not initialize.",
    );
    await evaluate(sidePanelDevTools, listingSeedScenario());
    await sidePanelDevTools.send("Page.reload");
    await waitForCondition(
      sidePanelDevTools,
      String.raw`
        (() => {
          const loading = document.getElementById("loading-view");
          const disclosure = document.getElementById("first-use-disclosure");
          return (
            document.documentElement?.dataset.surface === "side-panel" &&
            document.querySelector('[data-app-view="home"]') &&
            (!loading || loading.hidden) &&
            (!disclosure || disclosure.hidden) &&
            document.getElementById("current-count")?.textContent?.trim() === "2"
          );
        })()
      `,
      "Side panel dashboard did not become ready with the seeded listing data.",
    );
    await captureVisualCheckpoint(
      sidePanelDevTools,
      SCREENSHOT_SOURCES.homeDashboard,
      { width: 1280, height: 800 },
      checkpointDirectory,
    );

    await evaluate(
      sidePanelDevTools,
      String.raw`document.querySelector('[data-app-nav="library"]')?.click()`,
    );
    await waitForCondition(
      sidePanelDevTools,
      String.raw`
        (() => {
          const loading = document.getElementById("loading-view");
          return (
            !document.querySelector('[data-app-view="library"]')?.hidden &&
            document.getElementById("library-view-panel")?.getAttribute("aria-labelledby") ===
              "view-inbox-button" &&
            document.querySelector('[data-bookmark-id="111"]') &&
            (!loading || loading.hidden)
          );
        })()
      `,
      "Inbox library view did not become ready.",
    );
    await captureVisualCheckpoint(
      sidePanelDevTools,
      SCREENSHOT_SOURCES.libraryInbox,
      { width: 1280, height: 800 },
      checkpointDirectory,
    );

    await evaluate(
      sidePanelDevTools,
      String.raw`document.getElementById("view-current-button")?.click()`,
    );
    await waitForCondition(
      sidePanelDevTools,
      String.raw`
        (() => {
          return (
            document.getElementById("library-view-panel")?.getAttribute("aria-labelledby") ===
              "view-current-button" &&
            document.querySelector('[data-bookmark-id="222"]')
          );
        })()
      `,
      "Current library view did not become ready.",
    );
    await evaluate(
      sidePanelDevTools,
      String.raw`document.querySelector('[data-bookmark-id="222"]')?.click()`,
    );
    await waitForCondition(
      sidePanelDevTools,
      String.raw`
        (() => {
          return (
            !document.querySelector('[data-app-view="detail"]')?.hidden &&
            document.getElementById("selected-bookmark-title")?.textContent?.includes(
              "local research workflow",
            ) &&
            document.getElementById("selected-tags")?.children.length === 2 &&
            document.getElementById("folder-breadcrumb-list")?.children.length >= 2
          );
        })()
      `,
      "Bookmark detail view did not show the organized fixture bookmark.",
    );
    await captureVisualCheckpoint(
      sidePanelDevTools,
      SCREENSHOT_SOURCES.detailOrganizedBookmark,
      { width: 1280, height: 800 },
      checkpointDirectory,
    );

    await evaluate(
      sidePanelDevTools,
      String.raw`document.querySelector("[data-detail-back]")?.click()`,
    );
    await waitForCondition(
      sidePanelDevTools,
      String.raw`
        (() => {
          return (
            !document.querySelector('[data-app-view="library"]')?.hidden &&
            document.getElementById("library-view-panel")?.getAttribute("aria-labelledby") ===
              "view-current-button"
          );
        })()
      `,
      "Library view did not reopen after closing detail.",
    );
    await evaluate(
      sidePanelDevTools,
      String.raw`
        (() => {
          const summary = document.querySelector(".organization-panel > summary");
          summary?.click();
        })()
      `,
    );
    await waitForCondition(
      sidePanelDevTools,
      String.raw`
        (() => {
          const panel = document.querySelector(".organization-panel");
          return (
            panel?.open === true &&
            document.getElementById("folder-overview-list")?.children.length >= 3 &&
            document.getElementById("tag-overview-list")?.children.length >= 3
          );
        })()
      `,
      "Organization overview did not expand with the seeded folders and tags.",
    );
    await captureVisualCheckpoint(
      sidePanelDevTools,
      SCREENSHOT_SOURCES.libraryOrganization,
      { width: 1280, height: 800 },
      checkpointDirectory,
    );

    await evaluate(
      sidePanelDevTools,
      String.raw`
        (() => {
          const panel = document.querySelector(".organization-panel");
          if (panel?.open) {
            document.querySelector(".organization-panel > summary")?.click();
          }
          document.getElementById("view-archived-button")?.click();
          const input = document.getElementById("library-search");
          if (!(input instanceof HTMLInputElement)) return;
          input.value = "photography";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        })()
      `,
    );
    await waitForCondition(
      sidePanelDevTools,
      String.raw`
        (() => {
          const panel = document.querySelector(".organization-panel");
          const input = document.getElementById("library-search");
          return (
            panel?.open === false &&
            document.getElementById("library-view-panel")?.getAttribute("aria-labelledby") ===
              "view-archived-button" &&
            document.getElementById("view-archived-button")?.getAttribute("aria-selected") ===
              "true" &&
            input instanceof HTMLInputElement &&
            input.value === "photography" &&
            document.querySelectorAll("#bookmark-list [data-bookmark-id]").length === 1 &&
            document.querySelector('[data-bookmark-id="333"]')
          );
        })()
      `,
      "Archived search did not narrow the seeded archive view.",
    );
    await captureVisualCheckpoint(
      sidePanelDevTools,
      SCREENSHOT_SOURCES.libraryArchivedSearch,
      { width: 1280, height: 800 },
      checkpointDirectory,
    );
  } finally {
    sidePanelDevTools?.close();
    browserDevTools?.close();
    if (chromeProcess.exitCode === null) {
      chromeProcess.kill("SIGTERM");
      await Promise.race([
        once(chromeProcess, "exit"),
        new Promise((resolveDelay) => setTimeout(resolveDelay, 3000)),
      ]);
      if (chromeProcess.exitCode === null) {
        chromeProcess.kill("SIGKILL");
        await once(chromeProcess, "exit");
      }
    }
    await rm(profileDirectory, { recursive: true, force: true });
  }
}

function shellHtml(body, { width, height, background = "#f4f1e8" } = {}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      :root {
        color-scheme: light;
        font-family: "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif;
      }
      * { box-sizing: border-box; }
      html, body {
        margin: 0;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: ${background};
      }
      body {
        position: relative;
      }
      .canvas {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
      }
      .glow {
        position: absolute;
        inset: auto;
        border-radius: 999px;
        filter: blur(28px);
        opacity: 0.35;
      }
      .frame {
        position: absolute;
        border-radius: 28px;
        overflow: hidden;
        border: 1px solid rgb(15 20 25 / 10%);
        box-shadow:
          0 22px 60px rgb(15 20 25 / 18%),
          0 8px 20px rgb(15 20 25 / 10%);
        background: #fff;
      }
      .frame img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
        background: #fff;
      }
      .brand-chip {
        position: absolute;
        display: inline-flex;
        align-items: center;
        gap: 12px;
        padding: 14px 18px;
        border-radius: 999px;
        background: rgb(255 255 255 / 88%);
        box-shadow: 0 10px 24px rgb(15 20 25 / 12%);
        backdrop-filter: blur(12px);
      }
      .brand-chip img {
        width: 36px;
        height: 36px;
      }
      .brand-chip span {
        font-size: 18px;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: #0f1419;
      }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}

function smallPromoScene({ icon, dashboard, sidePanel, metadata }) {
  return shellHtml(
    `<main class="canvas">
      <div class="glow" style="width: 240px; height: 240px; left: -60px; top: -80px; background: #d7c85b;"></div>
      <div class="glow" style="width: 180px; height: 180px; right: -40px; bottom: -40px; background: #b8d8a8;"></div>
      <div class="brand-chip" style="left: 24px; top: 20px; padding: 12px 16px;">
        <img alt="" src="${icon}">
        <span style="font-size: 16px;">Bookmark X</span>
      </div>
      <section class="frame" style="left: 24px; bottom: 22px; width: 146px; height: 194px;">
        <img alt="" src="${dashboard}">
      </section>
      <section class="frame" style="left: 184px; top: 34px; width: 112px; height: 212px;">
        <img alt="" src="${sidePanel}">
      </section>
      <section class="frame" style="right: 18px; top: 34px; width: 178px; height: 212px;">
        <img alt="" src="${metadata}">
      </section>
    </main>`,
    { width: 440, height: 280, background: "#f5f0df" },
  );
}

function marqueeScene({ icon, dashboard, detail, options, metadata }) {
  return shellHtml(
    `<main class="canvas">
      <div class="glow" style="width: 420px; height: 420px; left: -100px; top: 80px; background: #d7c85b;"></div>
      <div class="glow" style="width: 360px; height: 360px; right: -80px; top: -120px; background: #b9d5f6;"></div>
      <div class="brand-chip" style="left: 56px; top: 42px; padding: 16px 22px;">
        <img alt="" src="${icon}">
        <span style="font-size: 28px;">Bookmark X</span>
      </div>
      <section class="frame" style="left: 60px; bottom: 48px; width: 244px; height: 340px;">
        <img alt="" src="${dashboard}">
      </section>
      <section class="frame" style="left: 330px; bottom: 48px; width: 244px; height: 340px;">
        <img alt="" src="${detail}">
      </section>
      <section class="frame" style="left: 610px; bottom: 48px; width: 360px; height: 340px;">
        <img alt="" src="${options}">
      </section>
      <section class="frame" style="right: 54px; bottom: 48px; width: 360px; height: 340px;">
        <img alt="" src="${metadata}">
      </section>
    </main>`,
    { width: 1400, height: 560, background: "#f5f0df" },
  );
}

async function renderStoreScreenshots({ checkpointDirectory, assetDirectory }) {
  const checkpointByScene = new Map(
    CHROME_WEB_STORE_SCREENSHOT_SCENES.map(({ filename, checkpoint }) => [
      filename,
      SCREENSHOT_SOURCES[
        checkpoint.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      ],
    ]),
  );
  for (const filename of CHROME_WEB_STORE_ASSET_FILENAMES.screenshots) {
    const checkpointFilename = checkpointByScene.get(filename);
    if (!checkpointFilename) {
      throw new Error(`Missing checkpoint mapping for ${filename}.`);
    }
    await copyFile(
      resolve(checkpointDirectory, checkpointFilename),
      resolve(assetDirectory, filename),
    );
  }
}

async function renderPromotionalImages({
  chromeBinary,
  screenshotImages,
  icon,
  assetDirectory,
}) {
  await renderHtmlScene({
    chromeBinary,
    html: smallPromoScene({
      icon,
      dashboard: screenshotImages.dashboardOverview,
      sidePanel: screenshotImages.libraryOrganization,
      metadata: screenshotImages.bookmarkDetail,
    }),
    outputPath: resolve(assetDirectory, CHROME_WEB_STORE_ASSET_FILENAMES.smallPromo),
    width: 440,
    height: 280,
  });
  await renderHtmlScene({
    chromeBinary,
    html: marqueeScene({
      icon,
      dashboard: screenshotImages.dashboardOverview,
      detail: screenshotImages.libraryInbox,
      options: screenshotImages.bookmarkDetail,
      metadata: screenshotImages.libraryArchivedSearch,
    }),
    outputPath: resolve(assetDirectory, CHROME_WEB_STORE_ASSET_FILENAMES.marquee),
    width: 1400,
    height: 560,
  });
}

async function generateChromeWebStoreAssets(
  directory = resolve(PROJECT_ROOT, CHROME_WEB_STORE_ASSET_DIRECTORY),
) {
  await access(resolve(DIST_DIRECTORY, "manifest.json"));
  const checkpointDirectory = await mkdtemp(
    join(tmpdir(), "bookmark-x-cws-checkpoints-"),
  );
  try {
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    await captureExtensionCheckpoints(checkpointDirectory);
    const chromeBinary = await findChromeBinary();
    await copyFile(
      ICON_SOURCE_PATH,
      resolve(directory, CHROME_WEB_STORE_ASSET_FILENAMES.icon),
    );
    const icon = dataUrl(await readFile(ICON_SOURCE_PATH));
    await renderStoreScreenshots({
      checkpointDirectory,
      assetDirectory: directory,
    });
    const screenshotImages = {
      dashboardOverview: dataUrl(
        await readFile(
          resolve(directory, CHROME_WEB_STORE_ASSET_FILENAMES.screenshots[0]),
        ),
      ),
      libraryInbox: dataUrl(
        await readFile(
          resolve(directory, CHROME_WEB_STORE_ASSET_FILENAMES.screenshots[1]),
        ),
      ),
      bookmarkDetail: dataUrl(
        await readFile(
          resolve(directory, CHROME_WEB_STORE_ASSET_FILENAMES.screenshots[2]),
        ),
      ),
      libraryOrganization: dataUrl(
        await readFile(
          resolve(directory, CHROME_WEB_STORE_ASSET_FILENAMES.screenshots[3]),
        ),
      ),
      libraryArchivedSearch: dataUrl(
        await readFile(
          resolve(directory, CHROME_WEB_STORE_ASSET_FILENAMES.screenshots[4]),
        ),
      ),
    };
    await renderPromotionalImages({
      chromeBinary,
      screenshotImages,
      icon,
      assetDirectory: directory,
    });
    return validateChromeWebStoreAssets(directory);
  } finally {
    await rm(checkpointDirectory, { recursive: true, force: true });
  }
}

function summaryLines(summary, directory) {
  return [
    `Chrome Web Store assets validated in ${directory}`,
    `- icon: ${summary.icon.filename} (${summary.icon.width}x${summary.icon.height})`,
    ...summary.screenshots.map(
      (file) => `- screenshot: ${file.filename} (${file.width}x${file.height})`,
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
