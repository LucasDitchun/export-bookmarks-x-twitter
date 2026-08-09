import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, resolve } from "node:path";

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
    document.documentElement?.dataset.settingsState !== "ready" &&
    document.documentElement?.dataset.settingsState !== "error"
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
    "search-live-filter",
    "data-keep-archived",
  ];
  return {
    state: document.documentElement?.dataset.settingsState ?? "missing",
    status: document.getElementById("settings-status")?.textContent ?? "missing",
    checked: Object.fromEntries(
      ids.map((id) => [id, document.getElementById(id)?.checked ?? "missing"]),
    ),
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
    payload: { format: "urls", locale: "en" },
  });
  const cleared = await chrome.runtime.sendMessage({ type: "CLEAR_ARCHIVE" });
  const after = await chrome.runtime.sendMessage({ type: "GET_STATUS" });

  return { before, completed, exported, cleared, after };
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
  };
  await chrome.storage.local.set({ scrapeRun: run });
  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "START_SCRAPE",
    runId: run.id,
  });
  return { tabId: tab.id, ...response };
})()
`;

function assertScenario(page, ui, start, result) {
  const { before, completed, exported, cleared, after } = result;
  if (page.url !== "https://x.com/i/bookmarks" || page.articles !== 2) {
    throw new Error(`The synthetic X page was not ready: ${JSON.stringify(page)}`);
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
    completed.data.scrape?.fetched !== 2 ||
    completed.data.stats.total !== 2
  ) {
    throw new Error(
      `The DOM capture did not complete: ${JSON.stringify({ start, completed })}`,
    );
  }
  if (
    !exported.ok ||
    exported.data.content !==
      "\uFEFFhttps://x.com/grace/status/222\nhttps://x.com/ada/status/111\n" ||
    !exported.data.filename.endsWith("-urls.txt")
  ) {
    throw new Error("The runtime TXT export did not match the scraped bookmarks.");
  }
  if (!cleared.ok || !after.ok || after.data.stats.total !== 0) {
    throw new Error("The runtime archive clear flow did not finish.");
  }
}

function assertOptionsDefaults(result) {
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
    "search-live-filter",
    "data-keep-archived",
  ];
  const expectedFalse = ["appearance-reduce-motion", "surface-side-panel"];
  const mismatches = [
    ...expectedTrue.filter((id) => result.checked[id] !== true),
    ...expectedFalse.filter((id) => result.checked[id] !== false),
  ];
  if (result.state !== "ready" || result.status !== "" || mismatches.length > 0) {
    throw new Error(
      `The options defaults did not render: ${JSON.stringify({ ...result, mismatches })}`,
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
  let workerDevTools;
  try {
    const port = await waitForDevToolsPort(profileDirectory);
    const worker = await waitForServiceWorker(port);
    const extensionId = new URL(worker.url).host;
    const popupTarget = await openTarget(
      port,
      `chrome-extension://${extensionId}/popup.html`,
    );
    popupDevTools = await connectDevTools(popupTarget.webSocketDebuggerUrl);
    await popupDevTools.send("Runtime.enable");

    const optionsTarget = await openTarget(
      port,
      `chrome-extension://${extensionId}/options.html`,
    );
    optionsDevTools = await connectDevTools(optionsTarget.webSocketDebuggerUrl);
    await optionsDevTools.send("Runtime.enable");
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
    assertOptionsDefaults(optionsEvaluation.result.value);

    if (VISUAL_CHECKPOINT_DIRECTORY) {
      await captureVisualCheckpoint(optionsDevTools, "options.png", {
        width: 1180,
        height: 900,
      });

      const sidePanelTarget = await openTarget(
        port,
        `chrome-extension://${extensionId}/popup.html?surface=side-panel`,
      );
      sidePanelDevTools = await connectDevTools(sidePanelTarget.webSocketDebuggerUrl);
      await sidePanelDevTools.send("Runtime.enable");
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

    workerDevTools = await connectDevTools(worker.webSocketDebuggerUrl);
    await workerDevTools.send("Runtime.enable");
    const startEvaluation = await workerDevTools.send("Runtime.evaluate", {
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
    assertScenario(
      pageEvaluation.result.value,
      uiEvaluation.result.value,
      startEvaluation.result.value,
      evaluation.result.value,
    );
    console.log(
      "Chrome smoke passed: settings defaults, X-page DOM scraping, UI, MV3 worker, IndexedDB, TXT export, and clear.",
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
    workerDevTools?.close();
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
