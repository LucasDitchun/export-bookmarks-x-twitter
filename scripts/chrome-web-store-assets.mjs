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
const DIST_DIRECTORY = resolve(PROJECT_ROOT, "dist");
const ICON_SOURCE_PATH = resolve(PROJECT_ROOT, "public/icons/icon-128.png");
const STARTUP_TIMEOUT_MS = 20_000;
const SCREENSHOT_SOURCES = Object.freeze({
  librarySearch: "library-search.png",
  libraryOrganization: "library-organization.png",
  detailOrganizedBookmark: "detail-organized-bookmark.png",
  captureRecent: "capture-recent.png",
  exportPrivate: "export-private.png",
});
export const CHROME_WEB_STORE_SCREENSHOT_SCENES = Object.freeze([
  Object.freeze({
    filename: CHROME_WEB_STORE_ASSET_FILENAMES.screenshots[0],
    checkpoint: "library-search",
    step: "01 / FIND",
    title: "Find it again.",
    accent: "#d9ff45",
  }),
  Object.freeze({
    filename: CHROME_WEB_STORE_ASSET_FILENAMES.screenshots[1],
    checkpoint: "library-organization",
    step: "02 / ORGANIZE",
    title: "Give it a place.",
    accent: "#d9ff45",
  }),
  Object.freeze({
    filename: CHROME_WEB_STORE_ASSET_FILENAMES.screenshots[2],
    checkpoint: "detail-organized-bookmark",
    step: "03 / REMEMBER",
    title: "Keep the context.",
    accent: "#d9ff45",
  }),
  Object.freeze({
    filename: CHROME_WEB_STORE_ASSET_FILENAMES.screenshots[3],
    checkpoint: "capture-recent",
    step: "04 / CAPTURE",
    title: "Only what’s new.",
    accent: "#d9ff45",
  }),
  Object.freeze({
    filename: CHROME_WEB_STORE_ASSET_FILENAMES.screenshots[4],
    checkpoint: "export-private",
    step: "05 / OWN",
    title: "Local means local.",
    accent: "#d9ff45",
  }),
]);

function listingBookmark({
  id,
  text,
  username,
  name,
  note = "",
  folderId = null,
  tagIds = [],
  status = "current",
  day,
}) {
  const savedAt = `2026-08-${String(day).padStart(2, "0")}T${String(
    8 + (day % 9),
  ).padStart(2, "0")}:15:00.000Z`;
  return Object.freeze({
    id,
    text,
    url: `https://x.com/bookmarkx/status/${id}`,
    author: Object.freeze({ id: `author-${id}`, username, name }),
    postCreatedAt: savedAt,
    media: Object.freeze({ images: [], videos: [] }),
    note,
    folderId,
    tagIds: Object.freeze(tagIds),
    firstSavedAt: savedAt,
    lastSeenAt: savedAt,
    archivedAt: status === "archived" ? "2026-08-15T08:45:00.000Z" : null,
    metadataUpdatedAt: savedAt,
    status,
  });
}

export const CHROME_WEB_STORE_LISTING_FIXTURE = Object.freeze({
  bookmarks: Object.freeze([
    listingBookmark({
      id: "111",
      text: "A practical system for turning saved posts into weekly research notes.",
      username: "fieldsystems",
      name: "Field Systems",
      tagIds: ["tag-research", "tag-workflow"],
      folderId: "folder-ai",
      note: "Compare this workflow with the Friday reading review.",
      day: 3,
    }),
    listingBookmark({
      id: "222",
      text: "How to keep a local research workflow organized across devices.",
      username: "localgraphs",
      name: "Local Graphs",
      note: "Pull quotes into the next reading review and compare with export filters.",
      folderId: "folder-ai",
      tagIds: ["tag-research", "tag-workflow"],
      day: 4,
    }),
    listingBookmark({
      id: "444",
      text: "Why local-first software keeps personal knowledge portable and private.",
      username: "ownyourdata",
      name: "Own Your Data",
      note: "Use this as a reference for the privacy section.",
      folderId: "folder-reading",
      tagIds: ["tag-research", "tag-open-source"],
      day: 5,
    }),
    listingBookmark({
      id: "555",
      text: "Designing calm interfaces for tools people use every day.",
      username: "quietinterfaces",
      name: "Quiet Interfaces",
      folderId: "folder-field-notes",
      tagIds: ["tag-design"],
      day: 6,
    }),
    listingBookmark({
      id: "666",
      text: "Search patterns that help you rediscover old research at the right moment.",
      username: "librarysystems",
      name: "Library Systems",
      note: "Test these search terms against notes, authors, and folders.",
      folderId: "folder-ai",
      tagIds: ["tag-research", "tag-design"],
      day: 7,
    }),
    listingBookmark({
      id: "777",
      text: "A compact checklist for evaluating open source browser extensions.",
      username: "webtoolkit",
      name: "Web Toolkit",
      tagIds: ["tag-open-source", "tag-workflow"],
      day: 8,
    }),
    listingBookmark({
      id: "888",
      text: "A reading queue works better when every saved link has a next action.",
      username: "smallarchive",
      name: "Small Archive",
      note: "Turn the strongest ideas into the onboarding checklist.",
      folderId: "folder-reading",
      tagIds: ["tag-workflow"],
      day: 9,
    }),
    listingBookmark({
      id: "999",
      text: "Visual hierarchy lessons from dense research dashboards.",
      username: "signalstudio",
      name: "Signal Studio",
      folderId: "folder-field-notes",
      tagIds: ["tag-design", "tag-research"],
      day: 10,
    }),
    listingBookmark({
      id: "1010",
      text: "How maintainers make release notes useful instead of ceremonial.",
      username: "releasefield",
      name: "Release Field",
      tagIds: ["tag-open-source", "tag-workflow"],
      day: 11,
    }),
    listingBookmark({
      id: "1111",
      text: "A thoughtful thread about keeping annotations close to the source.",
      username: "marginnotes",
      name: "Margin Notes",
      note: "Try this approach in the bookmark detail view.",
      day: 12,
    }),
    listingBookmark({
      id: "333",
      text: "Night photography field notes for tripod setup and manual focus.",
      username: "midnightmanual",
      name: "Midnight Manual",
      note: "Archive after copying the lens checklist into the travel pack.",
      folderId: "folder-field-notes",
      tagIds: ["tag-photography"],
      status: "archived",
      day: 13,
    }),
    listingBookmark({
      id: "1212",
      text: "An older research thread about durable export formats and plain text.",
      username: "portablearchives",
      name: "Portable Archives",
      folderId: "folder-reading",
      tagIds: ["tag-research", "tag-open-source"],
      status: "archived",
      day: 14,
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
    Object.freeze({ id: "tag-design", name: "Design", normalizedName: "design" }),
    Object.freeze({
      id: "tag-open-source",
      name: "Open source",
      normalizedName: "open source",
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
  await evaluateChromeExpression(
    devTools,
    waitForConditionExpression(predicate, failureMessage),
  );
}

export async function evaluateChromeExpression(devTools, expression) {
  const response = await devTools.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
  });
  if (response.exceptionDetails) {
    const description =
      response.result?.description ??
      response.exceptionDetails.exception?.description ??
      response.exceptionDetails.text;
    throw new Error(`Chrome checkpoint evaluation failed: ${description}`);
  }
  return response;
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
    await evaluateChromeExpression(sidePanelDevTools, listingSeedScenario());
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
            document.getElementById("current-count")?.textContent?.trim() === "10"
          );
        })()
      `,
      "Side panel dashboard did not become ready with the seeded listing data.",
    );
    await evaluateChromeExpression(
      sidePanelDevTools,
      String.raw`
        (() => {
          const modeField = document.getElementById("capture-mode-field");
          const mode = document.getElementById("capture-mode");
          const label = document.getElementById("capture-button-label");
          const button = document.getElementById("capture-button");
          const openButton = document.getElementById("open-bookmarks-button");
          const guidance = document.getElementById("page-guidance");
          const help = document.getElementById("capture-mode-help");
          if (modeField) modeField.hidden = false;
          if (mode instanceof HTMLSelectElement) mode.value = "quick";
          if (button) {
            button.hidden = false;
            button.disabled = false;
          }
          if (openButton) openButton.hidden = true;
          if (label) label.textContent = "Capture";
          if (guidance) guidance.textContent = "Add the newest bookmarks to your local library.";
          if (help) help.textContent = "Stops after 15 bookmarks already saved in a row.";
        })()
      `,
    );
    await captureVisualCheckpoint(
      sidePanelDevTools,
      SCREENSHOT_SOURCES.captureRecent,
      { width: 760, height: 670 },
      checkpointDirectory,
    );

    await evaluateChromeExpression(
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
            (!loading || loading.hidden)
          );
        })()
      `,
      "Library view did not become ready.",
    );
    await evaluateChromeExpression(
      sidePanelDevTools,
      String.raw`
        (() => {
          document.getElementById("view-current-button")?.click();
          const input = document.getElementById("library-search");
          if (!(input instanceof HTMLInputElement)) return;
          input.value = "research";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        })()
      `,
    );
    await waitForCondition(
      sidePanelDevTools,
      String.raw`
        (() => {
          return (
            document.getElementById("library-view-panel")?.getAttribute("aria-labelledby") ===
              "view-current-button" &&
            document.getElementById("library-search")?.value === "research" &&
            document.querySelectorAll("#bookmark-list [data-bookmark-id]").length >= 4 &&
            document.querySelector('[data-bookmark-id="222"]')
          );
        })()
      `,
      "Research search did not show the seeded matching bookmarks.",
    );
    await captureVisualCheckpoint(
      sidePanelDevTools,
      SCREENSHOT_SOURCES.librarySearch,
      { width: 760, height: 670 },
      checkpointDirectory,
    );
    await evaluateChromeExpression(
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
    await evaluateChromeExpression(
      sidePanelDevTools,
      String.raw`
        (() => {
          const note = document.getElementById("selected-note");
          if (note instanceof HTMLTextAreaElement) {
            note.style.setProperty("min-height", "84px", "important");
            note.style.setProperty("height", "84px", "important");
          }
          document.querySelector(".dashboard")?.scrollTo(0, 110);
        })()
      `,
    );
    await captureVisualCheckpoint(
      sidePanelDevTools,
      SCREENSHOT_SOURCES.detailOrganizedBookmark,
      { width: 760, height: 670 },
      checkpointDirectory,
    );

    await evaluateChromeExpression(
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
    await evaluateChromeExpression(
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
      { width: 760, height: 670 },
      checkpointDirectory,
    );

    await evaluateChromeExpression(
      sidePanelDevTools,
      String.raw`
        (() => {
          document.querySelector('[data-app-nav="settings"]')?.click();
          document.querySelector(".more-actions > summary")?.click();
        })()
      `,
    );
    await waitForCondition(
      sidePanelDevTools,
      String.raw`
        (() => {
          return (
            !document.querySelector('[data-app-view="settings"]')?.hidden &&
            document.querySelector(".more-actions")?.open === true &&
            document.getElementById("export-primary-button") &&
            document.getElementById("export-backup-button")
          );
        })()
      `,
      "Export and local backup controls did not become ready.",
    );
    await evaluateChromeExpression(
      sidePanelDevTools,
      String.raw`document.querySelector('[data-app-view="settings"]')?.scrollTo(0, 0)`,
    );
    await captureVisualCheckpoint(
      sidePanelDevTools,
      SCREENSHOT_SOURCES.exportPrivate,
      { width: 760, height: 670 },
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

function shellHtml(body, { width, height, background = "#0c0d0b" } = {}) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      :root {
        color-scheme: light;
        font-family: Verdana, Geneva, Tahoma, sans-serif;
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
      .frame {
        position: absolute;
        overflow: hidden;
        border: 2px solid #d9ff45;
        border-radius: 18px;
        background: #fffef5;
      }
      .frame img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
        background: #fffef5;
      }
      .brand {
        position: absolute;
        display: inline-flex;
        align-items: center;
        gap: 11px;
      }
      .brand img {
        width: 40px;
        height: 40px;
      }
      .brand span {
        font-size: 17px;
        font-weight: 700;
        letter-spacing: -0.02em;
        color: #fffef5;
      }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}

function listingScreenshotScene({ icon, screenshot, step, title, accent }) {
  return shellHtml(
    `<main class="canvas">
      <div style="position:absolute; inset:0; background:linear-gradient(115deg, #0c0d0b 0 25%, #171914 25% 100%);"></div>
      <div style="position:absolute; left:316px; top:0; width:8px; height:100%; background:${accent};"></div>
      <div class="brand" style="left:42px; top:38px;">
        <img alt="" src="${icon}">
        <span>Bookmark X</span>
      </div>
      <div style="position:absolute; left:42px; bottom:46px; width:238px; color:#fffef5;">
        <p style="margin:0 0 18px; color:${accent}; font:700 15px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace; letter-spacing:.12em;">${step}</p>
        <h1 style="margin:0; font-size:58px; line-height:.98; letter-spacing:-.065em;">${title}</h1>
      </div>
      <section class="frame" style="left:350px; top:24px; width:906px; height:752px;">
        <img alt="" src="${screenshot}">
      </section>
    </main>`,
    { width: 1280, height: 800 },
  );
}

function smallPromoScene({ icon }) {
  return shellHtml(
    `<main class="canvas">
      <div style="position:absolute; inset:0; background:#0c0d0b;"></div>
      <div style="position:absolute; right:0; top:0; width:28px; height:100%; background:#d9ff45;"></div>
      <div class="brand" style="left:28px; top:24px;">
        <img alt="" src="${icon}">
        <span style="font-size:20px;">Bookmark X</span>
      </div>
      <p style="position:absolute; left:28px; bottom:28px; margin:0; color:#fffef5; font-size:38px; font-weight:700; line-height:1; letter-spacing:-.055em;">Find what<br>you saved<span style="color:#d9ff45;">.</span></p>
    </main>`,
    { width: 440, height: 280 },
  );
}

function marqueeScene({ icon, search }) {
  return shellHtml(
    `<main class="canvas">
      <div style="position:absolute; inset:0; background:#0c0d0b;"></div>
      <div style="position:absolute; left:0; top:0; width:100%; height:14px; background:#d9ff45;"></div>
      <div class="brand" style="left:54px; top:48px;">
        <img alt="" src="${icon}">
        <span style="font-size:22px;">Bookmark X</span>
      </div>
      <div style="position:absolute; left:54px; bottom:52px; width:430px; color:#fffef5;">
        <h1 style="margin:0 0 22px; font-size:68px; line-height:.94; letter-spacing:-.07em;">Find what<br>you saved<span style="color:#d9ff45;">.</span></h1>
        <p style="margin:0; color:#d9ff45; font:700 16px/1.3 ui-monospace, SFMono-Regular, Consolas, monospace; letter-spacing:.1em;">LOCAL · SEARCHABLE · YOURS</p>
      </div>
      <section class="frame" style="left:535px; top:38px; width:830px; height:486px;">
        <img alt="" src="${search}">
      </section>
    </main>`,
    { width: 1400, height: 560 },
  );
}

async function renderStoreScreenshots({
  chromeBinary,
  checkpointDirectory,
  assetDirectory,
  icon,
}) {
  for (const scene of CHROME_WEB_STORE_SCREENSHOT_SCENES) {
    const checkpointFilename =
      SCREENSHOT_SOURCES[
        scene.checkpoint.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
      ];
    if (!checkpointFilename) {
      throw new Error(`Missing checkpoint mapping for ${scene.filename}.`);
    }
    const screenshot = dataUrl(
      await readFile(resolve(checkpointDirectory, checkpointFilename)),
    );
    await renderHtmlScene({
      chromeBinary,
      html: listingScreenshotScene({ icon, screenshot, ...scene }),
      outputPath: resolve(assetDirectory, scene.filename),
      width: 1280,
      height: 800,
    });
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
    html: smallPromoScene({ icon }),
    outputPath: resolve(assetDirectory, CHROME_WEB_STORE_ASSET_FILENAMES.smallPromo),
    width: 440,
    height: 280,
  });
  await renderHtmlScene({
    chromeBinary,
    html: marqueeScene({ icon, search: screenshotImages.search }),
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
      chromeBinary,
      checkpointDirectory,
      assetDirectory: directory,
      icon,
    });
    const screenshotImages = {
      search: dataUrl(
        await readFile(
          resolve(directory, CHROME_WEB_STORE_ASSET_FILENAMES.screenshots[0]),
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
