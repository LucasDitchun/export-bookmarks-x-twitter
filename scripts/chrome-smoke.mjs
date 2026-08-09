import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, resolve } from "node:path";

import {
  navigateToExtensionContext,
  waitForExtensionContext,
} from "./chrome-smoke-readiness.mjs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const DIST_DIRECTORY = resolve(PROJECT_ROOT, "dist");
const STARTUP_TIMEOUT_MS = 15_000;
const VISUAL_CHECKPOINT_DIRECTORY = process.env.BOOKMARK_X_VISUAL_DIR;

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function findChromeBinary() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const absoluteCandidates = ["/snap/chromium/current/usr/lib/chromium-browser/chrome"];
  for (const executable of absoluteCandidates) {
    try {
      await access(executable, constants.X_OK);
      return executable;
    } catch {
      // Continue with binaries available through PATH.
    }
  }
  const candidates = [
    "chromium",
    "chromium-browser",
    "google-chrome-for-testing",
    "google-chrome",
  ];
  for (const candidate of candidates) {
    for (const directory of (process.env.PATH ?? "").split(delimiter)) {
      const executable = resolve(directory, candidate);
      try {
        await access(executable, constants.X_OK);
        return executable;
      } catch {
        // Continue until a Chrome-compatible executable is found.
      }
    }
  }
  throw new Error(
    "No compatible browser found. Set CHROME_BIN to Chromium or Chrome for Testing.",
  );
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
    await delay(100);
  }
  throw new Error("Chrome DevTools did not become available.");
}

async function waitForServiceWorker(port) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
      response.json(),
    );
    const worker = targets.find(
      (target) =>
        target.type === "service_worker" &&
        target.url.startsWith("chrome-extension://"),
    );
    if (worker) return worker;
    await delay(100);
  }
  throw new Error("The Bookmark X service worker did not start.");
}

async function waitForPageTarget(port, predicate) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
      response.json(),
    );
    const page = targets.find(
      (target) => target.type === "page" && predicate(target.url),
    );
    if (page) return page;
    await delay(100);
  }
  throw new Error("The expected extension page did not become available.");
}

async function openTarget(port, url) {
  const response = await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,
    { method: "PUT" },
  );
  if (!response.ok) {
    throw new Error(`Chrome could not open the popup target (${response.status}).`);
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
  const listeners = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) {
      for (const listener of listeners.get(message.method) ?? []) {
        listener(message.params ?? {});
      }
      return;
    }
    const command = pending.get(message.id);
    if (!command) return;
    pending.delete(message.id);
    if (message.error) {
      command.reject(new Error(message.error.message));
    } else {
      command.resolve(message.result);
    }
  });

  return {
    close: () => socket.close(),
    on(method, listener) {
      const current = listeners.get(method) ?? [];
      current.push(listener);
      listeners.set(method, current);
    },
    send(method, params = {}) {
      commandId += 1;
      return new Promise((resolveCommand, rejectCommand) => {
        pending.set(commandId, {
          reject: rejectCommand,
          resolve: resolveCommand,
        });
        socket.send(JSON.stringify({ id: commandId, method, params }));
      });
    },
  };
}

async function captureVisualCheckpoint(devTools, filename, viewport) {
  if (!VISUAL_CHECKPOINT_DIRECTORY) return;
  await mkdir(VISUAL_CHECKPOINT_DIRECTORY, { recursive: true });
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
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const loading = document.getElementById("loading-view");
        if (!loading || loading.hidden) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    })()`,
    awaitPromise: true,
  });
  const screenshot = await devTools.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    fromSurface: true,
  });
  await writeFile(
    resolve(VISUAL_CHECKPOINT_DIRECTORY, filename),
    Buffer.from(screenshot.data, "base64"),
  );
}

const uiScenario = String.raw`
(async () => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const loading = document.getElementById("loading-view");
    if (loading?.hidden) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  return {
    title: document.title,
    dashboardVisible: document.getElementById("dashboard-view")?.hidden === false,
    captureDisabled: document.getElementById("capture-button")?.disabled === true,
    openBookmarksVisible:
      document.getElementById("open-bookmarks-button")?.hidden === false,
    alertHidden: document.getElementById("alert")?.hidden === true,
    typography: {
      root: getComputedStyle(document.documentElement).fontSize,
      body: getComputedStyle(document.body).fontSize,
      heading: getComputedStyle(document.getElementById("app-title")).fontSize,
      guidance: getComputedStyle(document.getElementById("page-guidance")).fontSize,
    },
  };
})()
`;

const optionsDefaultsScenario = String.raw`
(async () => {
  const deadline = Date.now() + 5000;
  while (
    Date.now() < deadline &&
    (document.documentElement?.dataset.settingsState !== "ready" ||
      !document.getElementById("semantic-status")?.textContent)
  ) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const ids = [
    "appearance-large-text",
    "appearance-high-contrast",
    "appearance-reduce-motion",
    "surface-modal",
    "surface-side-panel",
    "behavior-prompt",
    "metadata-summary",
    "metadata-breadcrumb",
    "metadata-tags",
    "metadata-note",
    "metadata-category",
    "export-link",
    "export-text",
    "export-author",
    "export-date",
    "export-images",
    "export-videos",
    "export-note",
    "export-tags",
    "export-folder",
    "export-first-saved",
    "export-last-seen",
    "search-live-filter",
    "semantic-enabled",
    "data-keep-archived",
  ];
  const semanticStorage = await chrome.storage.local.get("semanticSearchState");
  return {
    state: document.documentElement?.dataset.settingsState ?? "missing",
    status: document.getElementById("settings-status")?.textContent ?? "missing",
    checked: Object.fromEntries(
      ids.map((id) => [id, document.getElementById(id)?.checked ?? "missing"]),
    ),
    semanticInstallHidden:
      document.getElementById("semantic-install")?.hidden ?? "missing",
    semanticStatus: document.getElementById("semantic-status")?.textContent ?? "",
    huggingFaceRequests: performance
      .getEntriesByType("resource")
      .filter(({ name }) => /huggingface\.co|cdn\.hf\.co/u.test(name)).length,
    semanticStateStored: Object.hasOwn(semanticStorage, "semanticSearchState"),
    semanticModelCachePresent: (await caches.keys()).includes(
      "bookmark-x-transformers-v1",
    ),
  };
})()
`;

const sidePanelScenario = String.raw`
(async () => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const loading = document.getElementById("loading-view");
    if (
      document.documentElement?.dataset.surface === "side-panel" &&
      (!loading || loading.hidden)
    ) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return {
    url: location.href,
    title: document.title,
    surface: document.documentElement?.dataset.surface ?? "missing",
    dashboardVisible: document.getElementById("dashboard-view")?.hidden === false,
  };
})()
`;

const syntheticBookmarksPage = String.raw`
<!doctype html>
<html>
  <body>
    <main>
      <article data-testid="tweet">
        <div data-testid="User-Name">
          <a href="/ada"><span>Ada Lovelace</span></a><span>@ada</span>
        </div>
        <div data-testid="tweetText">First synthetic bookmark</div>
        <a href="/ada/status/111">
          <time datetime="2026-07-28T10:00:00.000Z">Jul 28</time>
        </a>
        <div data-testid="tweetPhoto">
          <img src="https://pbs.twimg.com/media/smoke?format=jpg&amp;name=large">
        </div>
        <div data-testid="videoPlayer">
          <video
            poster="https://pbs.twimg.com/ext_tw_video_thumb/111/pu/img/smoke.jpg"
            src="https://video.twimg.com/ext_tw_video/111/pu/vid/avc1/temporary.mp4"
          ></video>
        </div>
        <button type="button" data-testid="removeBookmark" aria-pressed="true">
          Remove bookmark
        </button>
      </article>
      <article data-testid="tweet">
        <div data-testid="User-Name">
          <a href="/grace"><span>Grace Hopper</span></a><span>@grace</span>
        </div>
        <div data-testid="tweetText">Second synthetic bookmark</div>
        <a href="/grace/status/222">
          <time datetime="2026-07-29T10:00:00.000Z">Jul 29</time>
        </a>
      </article>
    </main>
  </body>
</html>
`;

const pageReadyScenario = String.raw`
(async () => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (
      location.href.startsWith("https://x.com/i/bookmarks") &&
      document.querySelectorAll('article[data-testid="tweet"]').length === 2
    ) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return { url: location.href, articles: 2 };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return {
    url: location.href,
    articles: document.querySelectorAll('article[data-testid="tweet"]').length,
  };
})()
`;

const delayedLoaderScenario = String.raw`
(async () => {
  await new Promise((resolve) => setTimeout(resolve, 1300));
  const main = document.querySelector("main");
  if (!main) return { error: "timeline_missing" };
  const loader = document.createElement("div");
  loader.setAttribute("role", "progressbar");
  loader.setAttribute("aria-label", "Loading more bookmarks");
  main.append(loader);
  await new Promise((resolve) => setTimeout(resolve, 30));
  loader.remove();

  await new Promise((resolve) => setTimeout(resolve, 1270));
  main.insertAdjacentHTML(
    "beforeend",
    '<article data-testid="tweet"><div data-testid="User-Name"><a href="/katherine"><span>Katherine Johnson</span></a><span>@katherine</span></div><div data-testid="tweetText">Late bookmark after a transient loader</div><a href="/katherine/status/333"><time datetime="2026-07-30T10:00:00.000Z">Jul 30</time></a></article>',
  );
  return {
    loaderRemoved: !document.querySelector('[role="progressbar"]'),
    articles: document.querySelectorAll('article[data-testid="tweet"]').length,
  };
})()
`;

const runtimeScenario = String.raw`
(async () => {
  const before = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
  let completed;
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    completed = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
    if (
      completed?.data?.scrape?.status === "completed" ||
      completed?.data?.scrape?.status === "error"
    ) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const exported = await chrome.runtime.sendMessage({
    type: "EXPORT_BOOKMARKS",
    payload: {
      format: "txt",
      locale: "en",
      folderId: null,
      tagIds: [],
      includeArchived: true,
    },
  });
  const note = await chrome.runtime.sendMessage({
    type: "SAVE_BOOKMARK_NOTE",
    payload: { id: "111", note: "Preserved across live rebookmark" },
  });
  const decorations = await chrome.runtime.sendMessage({
    type: "GET_BOOKMARK_DECORATIONS",
    payload: { ids: ["111", "222"] },
  });

  return { before, completed, exported, note, decorations };
})()
`;

const metadataSetupScenario = String.raw`
(async () => {
  await chrome.storage.local.set({ uiLocale: "de" });
  const created = await chrome.runtime.sendMessage({
    type: "CREATE_FOLDER",
    payload: { name: "Research and long-form artificial intelligence", parentId: null },
  });
  const tagged = await chrome.runtime.sendMessage({
    type: "ADD_BOOKMARK_TAG",
    payload: { id: "111", name: "Machine learning research" },
  });
  const assigned = created?.data?.folder?.id
    ? await chrome.runtime.sendMessage({
        type: "ASSIGN_BOOKMARK_FOLDER",
        payload: { bookmarkId: "111", folderId: created.data.folder.id },
      })
    : null;
  return { created, tagged, assigned };
})()
`;

const filteredExportsScenario = (folderId, tagId) => String.raw`
(async () => {
  const txt = await chrome.runtime.sendMessage({
    type: "EXPORT_BOOKMARKS",
    payload: {
      format: "txt",
      locale: "en",
      folderId: ${JSON.stringify(folderId)},
      tagIds: [],
      includeArchived: false,
    },
  });
  const markdown = await chrome.runtime.sendMessage({
    type: "EXPORT_BOOKMARKS",
    payload: {
      format: "md",
      locale: "en",
      folderId: ${JSON.stringify(folderId)},
      tagIds: [${JSON.stringify(tagId)}],
      includeArchived: false,
    },
  });
  return { txt, markdown };
})()
`;

const metadataStateScenario = (expectedState) => String.raw`
(async () => {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const host = document.querySelector('article[data-testid="tweet"] bookmark-x-metadata');
    if (host?.dataset.state === ${JSON.stringify(expectedState)}) {
      return {
        state: host.dataset.state,
        hosts: document.querySelectorAll("bookmark-x-metadata").length,
        text: host.shadowRoot?.textContent ?? "",
        role: host.getAttribute("role"),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { state: "timeout", hosts: 0, text: "", role: null };
})()
`;

const metadataPendingScenario = String.raw`
(async () => {
  const button = document.querySelector('button[data-testid="removeBookmark"]');
  if (!button) return { state: "button-missing", hosts: 0, text: "" };
  button.click();
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const host = button.closest("article")?.querySelector("bookmark-x-metadata");
    if (host?.dataset.state === "pending") {
      return {
        state: host.dataset.state,
        hosts: button.closest("article")?.querySelectorAll("bookmark-x-metadata").length,
        text: host.shadowRoot?.textContent ?? "",
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return { state: "timeout", hosts: 0, text: "" };
})()
`;

const finishMetadataPendingScenario = String.raw`
(async () => {
  const button = document.querySelector(
    'button[data-testid="removeBookmark"], button[data-testid="bookmark"]',
  );
  if (!button) return { state: "button-missing" };
  button.dataset.testid = "bookmark";
  button.setAttribute("aria-pressed", "false");
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const host = button.closest("article")?.querySelector("bookmark-x-metadata");
    if (host?.dataset.state === "archived") {
      button.dataset.testid = "removeBookmark";
      button.setAttribute("aria-pressed", "true");
      return { state: host.dataset.state };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { state: "timeout" };
})()
`;

const liveBookmarkPageScenario = String.raw`
(async () => {
  const button = document.querySelector('button[data-testid="removeBookmark"]');
  if (!button) return { error: "live_button_missing" };
  const waitForModalState = async (state, fromIndex) => {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      const hosts = [...document.querySelectorAll("bookmark-x-note-modal")];
      const host = hosts[fromIndex] ?? hosts.at(-1);
      const current = host?.shadowRoot?.querySelector('[role="status"]')?.dataset.state;
      if (current === state) {
        return {
          state: current,
          formHidden: host.shadowRoot.querySelector("form")?.hidden ?? null,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { state: "timeout", formHidden: null };
  };

  button.click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  button.dataset.testid = "bookmark";
  button.setAttribute("aria-pressed", "false");
  const removed = await waitForModalState("success", 0);

  button.click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  button.dataset.testid = "removeBookmark";
  button.setAttribute("aria-pressed", "true");
  const saved = await waitForModalState("ready", 0);
  return { removed, saved, finalButton: button.dataset.testid };
})()
`;

const finalRuntimeScenario = String.raw`
(async () => {
  const bookmark = await chrome.runtime.sendMessage({
    type: "GET_BOOKMARK",
    payload: { id: "111" },
  });
  const stored = await chrome.storage.local.get("liveBookmarkContext");
  const backup = await chrome.runtime.sendMessage({ type: "EXPORT_BACKUP" });
  const cleared = await chrome.runtime.sendMessage({ type: "CLEAR_ARCHIVE" });
  const restored = await chrome.runtime.sendMessage({
    type: "RESTORE_BACKUP",
    payload: { content: backup.data.content, mode: "replace", confirmed: true },
  });
  const restoredSettings = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
  const restoredStatus = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
  const clearedAgain = await chrome.runtime.sendMessage({ type: "CLEAR_ARCHIVE" });
  const after = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
  return {
    bookmark,
    liveContext: stored.liveBookmarkContext ?? null,
    backup,
    cleared,
    restored,
    restoredSettings,
    restoredStatus,
    clearedAgain,
    after,
  };
})()
`;

const startContentCaptureScenario = String.raw`
(async () => {
  const tabs = await chrome.tabs.query({});
  let tab;
  for (const candidate of tabs) {
    if (typeof candidate.id !== "number") continue;
    try {
      const response = await chrome.tabs.sendMessage(candidate.id, {
        type: "CANCEL_SCRAPE",
        runId: "chrome-smoke-probe",
      });
      if (response?.accepted === true) {
        tab = candidate;
        break;
      }
    } catch {
      // Tabs without Bookmark X's restricted content script are expected.
    }
  }
  if (typeof tab?.id !== "number") {
    return { accepted: false, reason: "bookmarks_tab_missing" };
  }
  const now = new Date().toISOString();
  const run = {
    id: "chrome-smoke-run",
    tabId: tab.id,
    status: "running",
    fetched: 0,
    added: 0,
    updated: 0,
    startedAt: now,
    updatedAt: now,
    errorCode: null,
    mode: "full",
    checkpointIds: [],
    checkpointCandidates: [],
    checkpointMatchIds: [],
    completionReason: null,
  };
  await chrome.storage.local.set({ scrapeRun: run });
  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "START_SCRAPE",
    runId: run.id,
    mode: "full",
    checkpointIds: [],
  });
  return { tabId: tab.id, ...response };
})()
`;

const startQuickCaptureScenario = String.raw`
(async () => {
  const tabs = await chrome.tabs.query({});
  let tab;
  for (const candidate of tabs) {
    if (typeof candidate.id !== "number") continue;
    try {
      const probe = await chrome.tabs.sendMessage(candidate.id, {
        type: "CANCEL_SCRAPE",
        runId: "chrome-smoke-quick-probe",
      });
      if (probe?.accepted === true) {
        tab = candidate;
        break;
      }
    } catch {
      // Tabs without Bookmark X's restricted content script are expected.
    }
  }
  const { scrapeCheckpoints } = await chrome.storage.local.get("scrapeCheckpoints");
  if (typeof tab?.id !== "number" || scrapeCheckpoints?.ids?.length < 3) {
    return { accepted: false, reason: "checkpoints_missing", scrapeCheckpoints };
  }
  const now = new Date().toISOString();
  const run = {
    id: "chrome-smoke-quick-run",
    tabId: tab.id,
    status: "running",
    fetched: 0,
    added: 0,
    updated: 0,
    startedAt: now,
    updatedAt: now,
    errorCode: null,
    mode: "quick",
    checkpointIds: scrapeCheckpoints.ids,
    checkpointCandidates: [],
    checkpointMatchIds: [],
    completionReason: null,
  };
  await chrome.storage.local.set({ scrapeRun: run });
  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "START_SCRAPE",
    runId: run.id,
    mode: "quick",
    checkpointIds: scrapeCheckpoints.ids,
  });
  return { ...response, checkpointIds: scrapeCheckpoints.ids };
})()
`;

const waitForQuickCaptureScenario = String.raw`
(async () => {
  let status;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
    if (status?.data?.scrape?.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return status;
})()
`;

function assertScenario(
  page,
  ui,
  start,
  delayedLoader,
  result,
  quickStart,
  quickResult,
  livePage,
  finalResult,
) {
  const { before, completed, exported, note } = result;
  const {
    bookmark,
    liveContext,
    backup,
    cleared,
    restored,
    restoredSettings,
    restoredStatus,
    clearedAgain,
    after,
  } = finalResult;
  if (page.url !== "https://x.com/i/bookmarks" || page.articles !== 2) {
    throw new Error(`The synthetic X page was not ready: ${JSON.stringify(page)}`);
  }
  if (!delayedLoader.loaderRemoved || delayedLoader.articles !== 3) {
    throw new Error(
      `The delayed loader fixture did not finish: ${JSON.stringify(delayedLoader)}`,
    );
  }
  if (
    !ui.title.includes("Bookmark X") ||
    !ui.dashboardVisible ||
    !ui.captureDisabled ||
    !ui.openBookmarksVisible ||
    !ui.alertHidden
  ) {
    throw new Error(
      `The popup did not render its page-guidance state: ${JSON.stringify(ui)}`,
    );
  }
  const typography = Object.fromEntries(
    Object.entries(ui.typography ?? {}).map(([key, value]) => [
      key,
      Number.parseFloat(value),
    ]),
  );
  if (
    typography.root < 18 ||
    typography.body < 18 ||
    typography.heading <= 25 ||
    typography.guidance <= 17
  ) {
    throw new Error(
      `The large-text setting did not scale popup typography: ${JSON.stringify(ui.typography)}`,
    );
  }
  if (!before.ok) {
    throw new Error("The service worker did not return local archive status.");
  }
  if (
    start.accepted !== true ||
    !completed.ok ||
    completed.data.scrape?.status !== "completed" ||
    completed.data.scrape?.completionReason !== "stable_end" ||
    completed.data.scrape?.fetched !== 3 ||
    completed.data.stats.total !== 3 ||
    completed.data.quickUpdateAvailable !== true
  ) {
    throw new Error(
      `The DOM capture did not complete: ${JSON.stringify({ start, completed })}`,
    );
  }
  if (
    quickStart.accepted !== true ||
    quickStart.checkpointIds?.length !== 3 ||
    !quickResult?.ok ||
    quickResult.data.scrape?.status !== "completed" ||
    quickResult.data.scrape?.mode !== "quick" ||
    quickResult.data.scrape?.completionReason !== "checkpoint_stop" ||
    quickResult.data.scrape?.fetched !== 3
  ) {
    throw new Error(
      `The checkpoint quick update did not complete safely: ${JSON.stringify({ quickStart, quickResult })}`,
    );
  }
  if (
    !exported.ok ||
    !exported.data.content.includes("https://x.com/katherine/status/333") ||
    !exported.data.content.includes("https://x.com/grace/status/222") ||
    !exported.data.content.includes("https://x.com/ada/status/111") ||
    !exported.data.content.includes("First saved:") ||
    !exported.data.content.includes("Last seen:") ||
    !exported.data.filename.endsWith(".txt")
  ) {
    throw new Error("The runtime TXT export did not match the scraped bookmarks.");
  }
  if (!note.ok || note.data.bookmark?.note !== "Preserved across live rebookmark") {
    throw new Error("The live bookmark setup note was not saved.");
  }
  if (
    livePage.removed?.state !== "success" ||
    livePage.removed?.formHidden !== true ||
    livePage.saved?.state !== "ready" ||
    livePage.saved?.formHidden !== false ||
    livePage.finalButton !== "removeBookmark"
  ) {
    throw new Error(
      `The synthetic live bookmark UI failed: ${JSON.stringify(livePage)}`,
    );
  }
  if (
    !bookmark.ok ||
    bookmark.data.bookmark?.status !== "current" ||
    bookmark.data.bookmark?.note !== "Preserved across live rebookmark" ||
    bookmark.data.bookmark?.media?.images?.[0] !==
      "https://pbs.twimg.com/media/smoke?format=jpg&name=large" ||
    bookmark.data.bookmark?.media?.videos?.[0]?.thumbnailUrl !==
      "https://pbs.twimg.com/ext_tw_video_thumb/111/pu/img/smoke.jpg" ||
    bookmark.data.bookmark?.media?.videos?.[0]?.postUrl !==
      "https://x.com/ada/status/111" ||
    JSON.stringify(bookmark.data.bookmark?.media).includes("video.twimg.com") ||
    liveContext?.state !== "saved" ||
    liveContext?.bookmark?.id !== "111"
  ) {
    throw new Error(
      `The live rebookmark did not preserve local metadata: ${JSON.stringify({ bookmark, liveContext })}`,
    );
  }
  if (!cleared.ok || !after.ok || after.data.stats.total !== 0) {
    throw new Error("The runtime archive clear flow did not finish.");
  }
  const parsedBackup = backup.ok ? JSON.parse(backup.data.content) : null;
  if (
    !backup.ok ||
    parsedBackup?.schemaVersion !== 2 ||
    parsedBackup?.data?.bookmarks?.length !== 3 ||
    parsedBackup?.data?.bookmarks?.[0]?.media === undefined ||
    parsedBackup?.data?.settings?.extension?.schemaVersion !== 1 ||
    parsedBackup?.data?.settings?.extension?.settings?.behavior?.surface !== "modal" ||
    !restored.ok ||
    restored.data.bookmarks !== 3 ||
    restored.data.reloadRequired !== true ||
    !restoredSettings.ok ||
    restoredSettings.data.settings.behavior.surface !== "modal" ||
    !restoredStatus.ok ||
    restoredStatus.data.stats.total !== 3 ||
    restoredStatus.data.scrape !== null ||
    restoredStatus.data.quickUpdateAvailable !== false ||
    !clearedAgain.ok
  ) {
    throw new Error("The runtime JSON backup round-trip did not finish.");
  }
}

function assertOptionsDefaults(result, modelRequests) {
  const expectedTrue = [
    "appearance-large-text",
    "appearance-high-contrast",
    "surface-modal",
    "behavior-prompt",
    "metadata-summary",
    "metadata-breadcrumb",
    "metadata-tags",
    "metadata-note",
    "metadata-category",
    "export-link",
    "export-text",
    "export-author",
    "export-date",
    "export-images",
    "export-videos",
    "export-note",
    "export-tags",
    "export-folder",
    "export-first-saved",
    "export-last-seen",
    "search-live-filter",
    "data-keep-archived",
  ];
  const expectedFalse = [
    "appearance-reduce-motion",
    "surface-side-panel",
    "semantic-enabled",
  ];
  const mismatches = [
    ...expectedTrue.filter((id) => result.checked[id] !== true),
    ...expectedFalse.filter((id) => result.checked[id] !== false),
  ];
  if (
    result.state !== "ready" ||
    result.status !== "" ||
    result.semanticInstallHidden !== false ||
    !result.semanticStatus ||
    result.huggingFaceRequests !== 0 ||
    result.semanticStateStored !== false ||
    result.semanticModelCachePresent !== false ||
    modelRequests.length !== 0 ||
    mismatches.length > 0
  ) {
    throw new Error(
      `The options defaults did not render: ${JSON.stringify({ ...result, modelRequests, mismatches })}`,
    );
  }
}

function assertSidePanel(result) {
  if (
    !result.url.includes("popup.html?surface=side-panel") ||
    !result.title.includes("Bookmark X") ||
    result.surface !== "side-panel" ||
    result.dashboardVisible !== true
  ) {
    throw new Error(`The Side Panel entry did not render: ${JSON.stringify(result)}`);
  }
}

function assertFilteredExports(result) {
  const txt = result.txt;
  const markdown = result.markdown;
  if (
    !txt?.ok ||
    !txt.data.filename.endsWith(".txt") ||
    !txt.data.content.includes("1 item") ||
    !txt.data.content.includes(
      "Folder: Research and long-form artificial intelligence",
    ) ||
    !txt.data.content.includes("https://x.com/ada/status/111") ||
    txt.data.content.includes("https://x.com/grace/status/222") ||
    txt.data.content.includes("https://x.com/katherine/status/333") ||
    !txt.data.content.includes("First saved:") ||
    !txt.data.content.includes("Last seen:")
  ) {
    throw new Error(`The filtered TXT export failed: ${JSON.stringify(txt)}`);
  }
  if (
    !markdown?.ok ||
    !markdown.data.filename.endsWith(".md") ||
    !markdown.data.content.includes("1 item") ||
    !markdown.data.content.includes(
      "**Folder:** Research and long\\-form artificial intelligence",
    ) ||
    !markdown.data.content.includes("**Tags:** Machine learning research") ||
    !markdown.data.content.includes("https://x.com/ada/status/111") ||
    markdown.data.content.includes("https://x.com/grace/status/222") ||
    markdown.data.content.includes("https://x.com/katherine/status/333") ||
    !markdown.data.content.includes("**First saved:**") ||
    !markdown.data.content.includes("**Last seen:**")
  ) {
    throw new Error(
      `The folder-and-tag Markdown export failed: ${JSON.stringify(markdown)}`,
    );
  }
}

function assertMetadataCheckpoint(result, expectedState, expectedText) {
  if (
    result.state !== expectedState ||
    result.hosts !== 1 ||
    !result.text.includes(expectedText) ||
    (result.role !== undefined && result.role !== "group")
  ) {
    throw new Error(
      `The injected metadata checkpoint failed: ${JSON.stringify({ result, expectedState, expectedText })}`,
    );
  }
}

async function stopChrome(chromeProcess) {
  if (chromeProcess.exitCode !== null) return;
  chromeProcess.kill("SIGTERM");
  await Promise.race([once(chromeProcess, "exit"), delay(3_000)]);
  if (chromeProcess.exitCode === null) {
    chromeProcess.kill("SIGKILL");
    await once(chromeProcess, "exit");
  }
}

async function main() {
  await access(resolve(DIST_DIRECTORY, "manifest.json"));
  const chromeBinary = await findChromeBinary();
  const profileDirectory = await mkdtemp(
    resolve(PROJECT_ROOT, "chrome-smoke-profile-"),
  );
  const chromeErrors = [];
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
      `--user-data-dir=${profileDirectory}`,
      `--disable-extensions-except=${DIST_DIRECTORY}`,
      `--load-extension=${DIST_DIRECTORY}`,
      "--remote-debugging-port=0",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  chromeProcess.stderr.setEncoding("utf8");
  chromeProcess.stderr.on("data", (chunk) => {
    chromeErrors.push(chunk);
    if (chromeErrors.length > 20) chromeErrors.shift();
  });

  let popupDevTools;
  let optionsDevTools;
  let sidePanelDevTools;
  let pageDevTools;
  try {
    const port = await waitForDevToolsPort(profileDirectory);
    const worker = await waitForServiceWorker(port);
    const extensionId = new URL(worker.url).host;
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    const popupTarget = await openTarget(port, "about:blank");
    popupDevTools = await connectDevTools(popupTarget.webSocketDebuggerUrl);
    await popupDevTools.send("Runtime.enable");
    await navigateToExtensionContext(popupDevTools, popupUrl);

    const optionsTarget = await openTarget(port, "about:blank");
    optionsDevTools = await connectDevTools(optionsTarget.webSocketDebuggerUrl);
    await optionsDevTools.send("Runtime.enable");
    await optionsDevTools.send("Network.enable");
    const modelRequests = [];
    optionsDevTools.on("Network.requestWillBeSent", ({ request }) => {
      if (/huggingface\.co|cdn\.hf\.co/u.test(request?.url ?? "")) {
        modelRequests.push(request.url);
      }
    });
    const optionsUrl = `chrome-extension://${extensionId}/options.html`;
    await navigateToExtensionContext(optionsDevTools, optionsUrl);
    const optionsEvaluation = await optionsDevTools.send("Runtime.evaluate", {
      expression: optionsDefaultsScenario,
      awaitPromise: true,
      returnByValue: true,
    });
    if (optionsEvaluation.exceptionDetails) {
      throw new Error(
        optionsEvaluation.exceptionDetails.exception?.description ??
          optionsEvaluation.exceptionDetails.text,
      );
    }
    assertOptionsDefaults(optionsEvaluation.result.value, modelRequests);

    await openTarget(port, `chrome-extension://${extensionId}/sidepanel.html`);
    const sidePanelTarget = await waitForPageTarget(
      port,
      (url) =>
        url === `chrome-extension://${extensionId}/popup.html?surface=side-panel`,
    );
    sidePanelDevTools = await connectDevTools(sidePanelTarget.webSocketDebuggerUrl);
    await sidePanelDevTools.send("Runtime.enable");
    await waitForExtensionContext(
      sidePanelDevTools,
      `chrome-extension://${extensionId}/popup.html?surface=side-panel`,
    );
    const sidePanelEvaluation = await sidePanelDevTools.send("Runtime.evaluate", {
      expression: sidePanelScenario,
      awaitPromise: true,
      returnByValue: true,
    });
    if (sidePanelEvaluation.exceptionDetails) {
      throw new Error(
        sidePanelEvaluation.exceptionDetails.exception?.description ??
          sidePanelEvaluation.exceptionDetails.text,
      );
    }
    assertSidePanel(sidePanelEvaluation.result.value);

    if (VISUAL_CHECKPOINT_DIRECTORY) {
      await captureVisualCheckpoint(optionsDevTools, "options.png", {
        width: 1180,
        height: 900,
      });
      await captureVisualCheckpoint(sidePanelDevTools, "side-panel.png", {
        width: 500,
        height: 900,
      });
    }

    const pageTarget = await openTarget(port, "about:blank");
    pageDevTools = await connectDevTools(pageTarget.webSocketDebuggerUrl);
    await pageDevTools.send("Runtime.enable");
    await pageDevTools.send("Page.enable");
    await pageDevTools.send("Fetch.enable", {
      patterns: [{ urlPattern: "https://x.com/i/bookmarks*" }],
    });
    pageDevTools.on("Fetch.requestPaused", ({ requestId }) => {
      void pageDevTools.send("Fetch.fulfillRequest", {
        requestId,
        responseCode: 200,
        responseHeaders: [{ name: "Content-Type", value: "text/html; charset=utf-8" }],
        body: Buffer.from(syntheticBookmarksPage).toString("base64"),
      });
    });
    await pageDevTools.send("Page.navigate", {
      url: "https://x.com/i/bookmarks",
    });
    const pageEvaluation = await pageDevTools.send("Runtime.evaluate", {
      expression: pageReadyScenario,
      awaitPromise: true,
      returnByValue: true,
    });
    if (pageEvaluation.exceptionDetails) {
      throw new Error(
        pageEvaluation.exceptionDetails.exception?.description ??
          pageEvaluation.exceptionDetails.text,
      );
    }
    await pageDevTools.send("Page.bringToFront");

    const uiEvaluation = await popupDevTools.send("Runtime.evaluate", {
      expression: uiScenario,
      awaitPromise: true,
      returnByValue: true,
    });
    if (uiEvaluation.exceptionDetails) {
      throw new Error(
        uiEvaluation.exceptionDetails.exception?.description ??
          uiEvaluation.exceptionDetails.text,
      );
    }
    await captureVisualCheckpoint(popupDevTools, "popup.png", {
      width: 440,
      height: 900,
    });

    const startEvaluation = await popupDevTools.send("Runtime.evaluate", {
      expression: startContentCaptureScenario,
      awaitPromise: true,
      returnByValue: true,
    });
    if (startEvaluation.exceptionDetails) {
      throw new Error(
        startEvaluation.exceptionDetails.exception?.description ??
          startEvaluation.exceptionDetails.text,
      );
    }
    const delayedLoaderEvaluation = await pageDevTools.send("Runtime.evaluate", {
      expression: delayedLoaderScenario,
      awaitPromise: true,
      returnByValue: true,
    });
    if (delayedLoaderEvaluation.exceptionDetails) {
      throw new Error(
        delayedLoaderEvaluation.exceptionDetails.exception?.description ??
          delayedLoaderEvaluation.exceptionDetails.text,
      );
    }

    const evaluation = await popupDevTools.send("Runtime.evaluate", {
      expression: runtimeScenario,
      awaitPromise: true,
      returnByValue: true,
    });
    if (evaluation.exceptionDetails) {
      throw new Error(
        evaluation.exceptionDetails.exception?.description ??
          evaluation.exceptionDetails.text,
      );
    }
    const uncategorizedEvaluation = await pageDevTools.send("Runtime.evaluate", {
      expression: metadataStateScenario("uncategorized"),
      awaitPromise: true,
      returnByValue: true,
    });
    if (uncategorizedEvaluation.exceptionDetails) {
      throw new Error(
        uncategorizedEvaluation.exceptionDetails.exception?.description ??
          uncategorizedEvaluation.exceptionDetails.text,
      );
    }
    if (
      !evaluation.result.value.decorations?.ok ||
      evaluation.result.value.decorations.data.items?.length !== 2
    ) {
      throw new Error(
        `The runtime metadata lookup failed: ${JSON.stringify({ start: startEvaluation.result.value, completed: evaluation.result.value.completed, note: evaluation.result.value.note, decorations: evaluation.result.value.decorations })}`,
      );
    }
    assertMetadataCheckpoint(
      uncategorizedEvaluation.result.value,
      "uncategorized",
      "Needs category",
    );
    await captureVisualCheckpoint(pageDevTools, "metadata-uncategorized-en.png", {
      width: 760,
      height: 900,
    });

    const metadataSetupEvaluation = await popupDevTools.send("Runtime.evaluate", {
      expression: metadataSetupScenario,
      awaitPromise: true,
      returnByValue: true,
    });
    if (metadataSetupEvaluation.exceptionDetails) {
      throw new Error(
        metadataSetupEvaluation.exceptionDetails.exception?.description ??
          metadataSetupEvaluation.exceptionDetails.text,
      );
    }
    if (
      !metadataSetupEvaluation.result.value.created?.ok ||
      !metadataSetupEvaluation.result.value.tagged?.ok ||
      !metadataSetupEvaluation.result.value.assigned?.ok
    ) {
      throw new Error(
        `Could not prepare mapped metadata: ${JSON.stringify(metadataSetupEvaluation.result.value)}`,
      );
    }
    const filteredExportsEvaluation = await popupDevTools.send("Runtime.evaluate", {
      expression: filteredExportsScenario(
        metadataSetupEvaluation.result.value.created.data.folder.id,
        metadataSetupEvaluation.result.value.tagged.data.tag.id,
      ),
      awaitPromise: true,
      returnByValue: true,
    });
    if (filteredExportsEvaluation.exceptionDetails) {
      throw new Error(
        filteredExportsEvaluation.exceptionDetails.exception?.description ??
          filteredExportsEvaluation.exceptionDetails.text,
      );
    }
    assertFilteredExports(filteredExportsEvaluation.result.value);
    const mappedEvaluation = await pageDevTools.send("Runtime.evaluate", {
      expression: metadataStateScenario("mapped"),
      awaitPromise: true,
      returnByValue: true,
    });
    if (mappedEvaluation.exceptionDetails) {
      throw new Error(
        mappedEvaluation.exceptionDetails.exception?.description ??
          mappedEvaluation.exceptionDetails.text,
      );
    }
    assertMetadataCheckpoint(
      mappedEvaluation.result.value,
      "mapped",
      "Von Bookmark X in der lokalen Sammlung erfasst",
    );
    await captureVisualCheckpoint(pageDevTools, "metadata-mapped-de.png", {
      width: 760,
      height: 900,
    });

    const pendingEvaluation = await pageDevTools.send("Runtime.evaluate", {
      expression: metadataPendingScenario,
      awaitPromise: true,
      returnByValue: true,
    });
    if (pendingEvaluation.exceptionDetails) {
      throw new Error(
        pendingEvaluation.exceptionDetails.exception?.description ??
          pendingEvaluation.exceptionDetails.text,
      );
    }
    assertMetadataCheckpoint(pendingEvaluation.result.value, "pending", "Warten");
    await captureVisualCheckpoint(pageDevTools, "metadata-pending-de.png", {
      width: 760,
      height: 900,
    });
    const finishPendingEvaluation = await pageDevTools.send("Runtime.evaluate", {
      expression: finishMetadataPendingScenario,
      awaitPromise: true,
      returnByValue: true,
    });
    if (
      finishPendingEvaluation.exceptionDetails ||
      finishPendingEvaluation.result.value.state !== "archived"
    ) {
      throw new Error("The injected pending state did not settle as archived.");
    }
    const quickStartEvaluation = await popupDevTools.send("Runtime.evaluate", {
      expression: startQuickCaptureScenario,
      awaitPromise: true,
      returnByValue: true,
    });
    if (quickStartEvaluation.exceptionDetails) {
      throw new Error(
        quickStartEvaluation.exceptionDetails.exception?.description ??
          quickStartEvaluation.exceptionDetails.text,
      );
    }
    const quickEvaluation = await popupDevTools.send("Runtime.evaluate", {
      expression: waitForQuickCaptureScenario,
      awaitPromise: true,
      returnByValue: true,
    });
    if (quickEvaluation.exceptionDetails) {
      throw new Error(
        quickEvaluation.exceptionDetails.exception?.description ??
          quickEvaluation.exceptionDetails.text,
      );
    }
    const livePageEvaluation = await pageDevTools.send("Runtime.evaluate", {
      expression: liveBookmarkPageScenario,
      awaitPromise: true,
      returnByValue: true,
    });
    if (livePageEvaluation.exceptionDetails) {
      throw new Error(
        livePageEvaluation.exceptionDetails.exception?.description ??
          livePageEvaluation.exceptionDetails.text,
      );
    }
    const finalEvaluation = await popupDevTools.send("Runtime.evaluate", {
      expression: finalRuntimeScenario,
      awaitPromise: true,
      returnByValue: true,
    });
    if (finalEvaluation.exceptionDetails) {
      throw new Error(
        finalEvaluation.exceptionDetails.exception?.description ??
          finalEvaluation.exceptionDetails.text,
      );
    }
    assertScenario(
      pageEvaluation.result.value,
      uiEvaluation.result.value,
      startEvaluation.result.value,
      delayedLoaderEvaluation.result.value,
      evaluation.result.value,
      quickStartEvaluation.result.value,
      quickEvaluation.result.value,
      livePageEvaluation.result.value,
      finalEvaluation.result.value,
    );
    console.log(
      "Chrome smoke passed: real Options and Side Panel pages, no pre-consent model cache/download, delayed-loader full review, checkpoint quick update, injected metadata states/localization, live unbookmark/rebookmark, metadata preservation, UI, MV3 worker, filtered TXT/Markdown exports with timestamps, JSON backup round-trip, and clear.",
    );
    if (VISUAL_CHECKPOINT_DIRECTORY) {
      console.log(`Visual checkpoints: ${VISUAL_CHECKPOINT_DIRECTORY}`);
    }
  } catch (error) {
    const diagnostics = chromeErrors.join("").trim();
    if (diagnostics) {
      console.error(diagnostics.split("\n").slice(-20).join("\n"));
    }
    throw error;
  } finally {
    popupDevTools?.close();
    optionsDevTools?.close();
    sidePanelDevTools?.close();
    pageDevTools?.close();
    await stopChrome(chromeProcess);
    await rm(profileDirectory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
}

await main();
