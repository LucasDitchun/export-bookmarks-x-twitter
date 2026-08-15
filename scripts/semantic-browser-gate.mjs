#!/usr/bin/env node

import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const STARTUP_TIMEOUT_MS = 20_000;
const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const DIST_DIRECTORY = resolve(PROJECT_ROOT, "dist");
const CACHE_KEY = "bookmark-x-transformers-v1";
const SEMANTIC_MODEL_ORIGINS = Object.freeze([
  "https://huggingface.co/*",
  "https://*.cdn.hf.co/*",
]);
const MODEL_REVISION = "761b726dd34fb83930e26aab4e9ac3899aa1fa78";
const EXPECTED_BOOKMARK_ID = "701";
const SEMANTIC_QUERY = "Como consertar o pneu furado da bicicleta?";

const delay = (milliseconds) =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

export function parseArguments(args) {
  let run = false;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let keepProfile = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--run") {
      run = true;
    } else if (argument === "--keep-profile") {
      keepProfile = true;
    } else if (argument === "--timeout-ms") {
      const raw = args[index + 1];
      const parsed = Number(raw);
      if (!Number.isSafeInteger(parsed) || parsed < 10_000) {
        throw new Error("--timeout-ms must be an integer of at least 10000.");
      }
      timeoutMs = parsed;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { run, timeoutMs, keepProfile };
}

export function createHeadlessGateManifest(manifest) {
  const required = [...(manifest.host_permissions ?? [])];
  const optional = [...(manifest.optional_host_permissions ?? [])];
  for (const origin of SEMANTIC_MODEL_ORIGINS) {
    if (!optional.includes(origin) || required.includes(origin)) {
      throw new Error(
        `Production manifest must declare ${origin} only as an optional host permission.`,
      );
    }
  }
  const remainingOptional = optional.filter(
    (origin) => !SEMANTIC_MODEL_ORIGINS.includes(origin),
  );
  const { optional_host_permissions: ignored, ...rest } = manifest;
  return {
    ...rest,
    host_permissions: [...required, ...SEMANTIC_MODEL_ORIGINS],
    ...(remainingOptional.length === 0
      ? {}
      : { optional_host_permissions: remainingOptional }),
  };
}

async function stageHeadlessGateExtension(profileDirectory) {
  const extensionDirectory = resolve(profileDirectory, "headless-extension");
  await cp(DIST_DIRECTORY, extensionDirectory, { recursive: true });
  const manifestPath = resolve(extensionDirectory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await writeFile(
    manifestPath,
    `${JSON.stringify(createHeadlessGateManifest(manifest), null, 2)}\n`,
  );
  return extensionDirectory;
}

async function findChromeBinary() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const candidates = [
    "/snap/chromium/current/usr/lib/chromium-browser/chrome",
    ...[
      "chromium",
      "chromium-browser",
      "google-chrome-for-testing",
      "google-chrome",
    ].flatMap((name) =>
      (process.env.PATH ?? "")
        .split(delimiter)
        .map((directory) => resolve(directory, name)),
    ),
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue until an executable Chrome-compatible browser is found.
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

async function targets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok)
    throw new Error(`Could not list Chrome targets (${response.status}).`);
  return response.json();
}

async function waitForExtensionWorker(port) {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const worker = (await targets(port)).find(
      (target) =>
        target.type === "service_worker" &&
        target.url.startsWith("chrome-extension://"),
    );
    if (worker) return worker;
    await delay(100);
  }
  throw new Error("The Bookmark X extension service worker did not start.");
}

async function openTarget(port, url) {
  const response = await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,
    { method: "PUT" },
  );
  if (!response.ok)
    throw new Error(`Chrome could not open a target (${response.status}).`);
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
        listener(message.params ?? {}, message.sessionId);
      }
      return;
    }
    const command = pending.get(message.id);
    if (!command) return;
    pending.delete(message.id);
    if (message.error) command.reject(new Error(message.error.message));
    else command.resolve(message.result);
  });
  return {
    close: () => socket.close(),
    on(method, listener) {
      const current = listeners.get(method) ?? [];
      current.push(listener);
      listeners.set(method, current);
    },
    send(method, params = {}, sessionId) {
      commandId += 1;
      return new Promise((resolveCommand, rejectCommand) => {
        pending.set(commandId, { resolve: resolveCommand, reject: rejectCommand });
        socket.send(
          JSON.stringify({
            id: commandId,
            method,
            params,
            ...(sessionId === undefined ? {} : { sessionId }),
          }),
        );
      });
    },
  };
}

async function connectBrowserMonitor(port, diagnostics, modelRequests) {
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then(
    (response) => response.json(),
  );
  const devTools = await connectDevTools(version.webSocketDebuggerUrl);
  const workerSessions = new Set();
  devTools.on("Target.attachedToTarget", ({ sessionId, targetInfo }) => {
    if (targetInfo?.type !== "worker") return;
    workerSessions.add(sessionId);
    diagnostics.push(`attached to worker ${targetInfo.url}`);
    void Promise.all([
      devTools.send("Runtime.enable", {}, sessionId),
      devTools.send("Network.enable", {}, sessionId),
    ]).catch((error) => diagnostics.push(`Could not enable worker CDP: ${error}`));
  });
  devTools.on("Runtime.exceptionThrown", ({ exceptionDetails }, sessionId) => {
    if (!workerSessions.has(sessionId)) return;
    diagnostics.push(
      exceptionDetails?.exception?.description ??
        exceptionDetails?.text ??
        "Unknown worker exception",
    );
  });
  devTools.on("Runtime.consoleAPICalled", ({ type, args }, sessionId) => {
    if (!workerSessions.has(sessionId) || (type !== "error" && type !== "warning")) {
      return;
    }
    diagnostics.push(
      `${type}: ${args?.map(({ value, description }) => value ?? description).join(" ")}`,
    );
  });
  devTools.on("Network.requestWillBeSent", ({ requestId, request }, sessionId) => {
    if (
      workerSessions.has(sessionId) &&
      /huggingface\.co|cdn\.hf\.co/u.test(request?.url ?? "")
    ) {
      modelRequests.push(request.url);
    }
  });
  await devTools.send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });
  return devTools;
}

async function enableChildWorkerDebugger(devTools, diagnostics, modelRequests) {
  const workerSessions = new Set();
  const remoteRequests = new Map();
  devTools.on("Target.attachedToTarget", ({ sessionId, targetInfo }) => {
    diagnostics.push(`child target ${targetInfo?.type}: ${targetInfo?.url}`);
    if (targetInfo?.type !== "worker") return;
    workerSessions.add(sessionId);
    void Promise.all([
      devTools.send("Runtime.enable", {}, sessionId),
      devTools.send("Network.enable", {}, sessionId),
      devTools
        .send("Debugger.enable", {}, sessionId)
        .then(() =>
          devTools.send("Debugger.setPauseOnExceptions", { state: "all" }, sessionId),
        ),
    ]).catch((error) => diagnostics.push(`Could not enable worker debugger: ${error}`));
  });
  devTools.on("Debugger.paused", ({ data, reason, callFrames }, sessionId) => {
    if (!workerSessions.has(sessionId)) return;
    diagnostics.push(
      `worker paused (${reason}): ${data?.description ?? data?.value ?? "unknown"}\n` +
        (callFrames ?? [])
          .slice(0, 5)
          .map(
            ({ functionName, url, location }) =>
              `${functionName || "<anonymous>"} ${url}:${location?.lineNumber ?? 0}`,
          )
          .join("\n"),
    );
    void devTools.send("Debugger.resume", {}, sessionId).catch(() => undefined);
  });
  devTools.on("Network.requestWillBeSent", ({ requestId, request }, sessionId) => {
    if (
      workerSessions.has(sessionId) &&
      /huggingface\.co|cdn\.hf\.co/u.test(request?.url ?? "")
    ) {
      modelRequests.push(request.url);
      remoteRequests.set(`${sessionId}:${requestId}`, request.url);
    }
  });
  devTools.on("Network.responseReceived", ({ response }, sessionId) => {
    if (
      !workerSessions.has(sessionId) ||
      !/huggingface\.co|cdn\.hf\.co/u.test(response?.url ?? "")
    ) {
      return;
    }
    const url = new URL(response.url);
    diagnostics.push(`worker response ${response.status} ${url.origin}${url.pathname}`);
  });
  devTools.on(
    "Network.loadingFailed",
    ({ requestId, errorText, blockedReason, canceled }, sessionId) => {
      if (!workerSessions.has(sessionId)) return;
      const url = remoteRequests.get(`${sessionId}:${requestId}`);
      diagnostics.push(
        `worker request failed ${errorText} blocked=${blockedReason ?? "no"} ` +
          `cancelled=${String(canceled)}${url ? ` ${new URL(url).pathname}` : ` request=${requestId}`}`,
      );
    },
  );
  await devTools.send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });
}

async function monitorWorkerTargets(port, stopped, diagnostics) {
  const connections = new Map();
  try {
    while (!stopped()) {
      for (const target of await targets(port)) {
        if (
          target.type !== "worker" ||
          !target.url.startsWith("chrome-extension://") ||
          connections.has(target.id) ||
          !target.webSocketDebuggerUrl
        ) {
          continue;
        }
        try {
          const devTools = await connectDevTools(target.webSocketDebuggerUrl);
          connections.set(target.id, devTools);
          devTools.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
            diagnostics.push(
              exceptionDetails?.exception?.description ??
                exceptionDetails?.text ??
                "Unknown worker exception",
            );
          });
          devTools.on("Runtime.consoleAPICalled", ({ type, args }) => {
            if (type !== "error" && type !== "warning") return;
            diagnostics.push(
              `${type}: ${args?.map(({ value, description }) => value ?? description).join(" ")}`,
            );
          });
          await devTools.send("Runtime.enable");
        } catch (error) {
          diagnostics.push(`Could not inspect semantic worker: ${String(error)}`);
        }
      }
      await delay(50);
    }
  } finally {
    for (const connection of connections.values()) connection.close();
  }
}

async function evaluate(devTools, expression, label, userGesture = false) {
  const evaluation = await devTools.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: userGesture,
  });
  if (evaluation.exceptionDetails) {
    throw new Error(
      `${label}: ${evaluation.exceptionDetails.exception?.description ?? evaluation.exceptionDetails.text}`,
    );
  }
  return evaluation.result.value;
}

function bookmark(id, text, username) {
  return {
    id,
    text,
    url: `https://x.com/${username}/status/${id}`,
    author: { id: `author_${id}`, username, name: username },
    postCreatedAt: "2026-01-01T00:00:00.000Z",
    media: { images: [], videos: [] },
    note: "",
    folderId: null,
    tagIds: [],
    firstSavedAt: "2026-01-02T00:00:00.000Z",
    lastSeenAt: "2026-01-02T00:00:00.000Z",
    archivedAt: null,
    metadataUpdatedAt: "2026-01-02T00:00:00.000Z",
    status: "current",
  };
}

const syntheticBookmarks = Object.freeze([
  bookmark(
    EXPECTED_BOOKMARK_ID,
    "A practical guide to patching a punctured inner tube and inflating a bicycle tire.",
    "cycle_guide",
  ),
  bookmark(
    "702",
    "A mushroom risotto recipe with warm stock, toasted rice, and a creamy finish.",
    "kitchen_notes",
  ),
  bookmark(
    "703",
    "A night photography guide to tripod setup and focusing on the Milky Way.",
    "camera_field",
  ),
]);

const seedScenario = String.raw`
(async () => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && !document.getElementById("semantic-status")?.textContent) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const beforeState = await chrome.storage.local.get("semanticSearchState");
  const beforeCaches = await caches.keys();
  const beforeDatabases = typeof indexedDB.databases === "function"
    ? (await indexedDB.databases()).map(({ name }) => name)
    : [];
  const disclosure = await chrome.runtime.sendMessage({
    type: "ACCEPT_FIRST_USE_DISCLOSURE",
  });
  const exported = await chrome.runtime.sendMessage({ type: "EXPORT_BACKUP" });
  if (!exported?.ok) throw new Error("Could not create an empty synthetic backup.");
  const backup = JSON.parse(exported.data.content);
  backup.data.bookmarks = ${JSON.stringify(syntheticBookmarks)};
  const restored = await chrome.runtime.sendMessage({
    type: "RESTORE_BACKUP",
    payload: { content: JSON.stringify(backup), mode: "replace", confirmed: true },
  });
  return {
    beforeStateStored: Object.hasOwn(beforeState, "semanticSearchState"),
    beforeCaches,
    beforeDatabases,
    disclosureAccepted: disclosure?.ok && disclosure.data?.accepted === true,
    restored,
  };
})()
`;

const installScenario = (timeoutMs) => String.raw`
(async () => {
  const states = [];
  const startedAt = performance.now();
  const onChanged = (changes, area) => {
    const state = changes.semanticSearchState?.newValue?.state;
    if (area === "local" && state) {
      states.push({ status: state.modelStatus, at: performance.now() - startedAt });
    }
  };
  chrome.storage.onChanged.addListener(onChanged);
  document.getElementById("semantic-install").click();
  const deadline = Date.now() + ${timeoutMs};
  let state;
  while (Date.now() < deadline) {
    state = (await chrome.storage.local.get("semanticSearchState"))
      .semanticSearchState?.state;
    if (state?.modelStatus === "ready" || state?.modelStatus === "error") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  chrome.storage.onChanged.removeListener(onChanged);
  if (state?.modelStatus !== "ready") {
    throw new Error("Semantic install did not become ready: " + JSON.stringify(state));
  }
  const cacheNames = await caches.keys();
  const cache = await caches.open(${JSON.stringify(CACHE_KEY)});
  const cachedRequests = (await cache.keys()).map(({ url }) => url).sort();
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open("bookmark-x-semantic", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const transaction = database.transaction(["embeddings", "meta"], "readonly");
  const embeddingsRequest = transaction.objectStore("embeddings").getAll();
  const dimensionsRequest = transaction.objectStore("meta").get("dimensions");
  const embeddings = await new Promise((resolve, reject) => {
    embeddingsRequest.onsuccess = () => resolve(embeddingsRequest.result);
    embeddingsRequest.onerror = () => reject(embeddingsRequest.error);
  });
  const dimensions = await new Promise((resolve, reject) => {
    dimensionsRequest.onsuccess = () => resolve(dimensionsRequest.result?.value ?? 0);
    dimensionsRequest.onerror = () => reject(dimensionsRequest.error);
  });
  await new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  database.close();
  const lexical = await chrome.runtime.sendMessage({
    type: "SEARCH_BOOKMARKS",
    payload: { query: ${JSON.stringify(SEMANTIC_QUERY)}, view: "current", limit: 50 },
  });
  const indexing = states.find(({ status }) => status === "indexing")?.at ?? null;
  const ready = [...states].reverse().find(({ status }) => status === "ready")?.at ?? null;
  return {
    state,
    states,
    timings: {
      downloadAndLoadMilliseconds: indexing,
      indexingMilliseconds: indexing === null || ready === null ? null : ready - indexing,
      totalInstallMilliseconds: performance.now() - startedAt,
    },
    cacheNames,
    cachedRequests,
    index: {
      dimensions,
      entries: embeddings.map((entry) => ({
        id: entry.id,
        fingerprint: entry.fingerprint,
        dimensions: entry.vector.length,
        finite: entry.vector.every(Number.isFinite),
      })),
    },
    lexical,
  };
})()
`;

const offlineSearchScenario = (timeoutMs) => String.raw`
(async () => {
  const readyDeadline = Date.now() + 10000;
  while (Date.now() < readyDeadline) {
    if (document.getElementById("dashboard-view")?.hidden === false) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  document.getElementById("view-current-button").click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const input = document.getElementById("library-search");
  input.value = ${JSON.stringify(SEMANTIC_QUERY)};
  const startedAt = performance.now();
  document.getElementById("library-search-button").click();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const searchingStatus = document.getElementById("library-search-status")?.textContent ?? "";
  const deadline = Date.now() + ${timeoutMs};
  let ids = [];
  let settledWithoutResults = false;
  while (Date.now() < deadline) {
    ids = [...document.querySelectorAll("#bookmark-list [data-bookmark-id]")]
      .map(({ dataset }) => dataset.bookmarkId);
    if (ids.length > 0) break;
    const currentStatus = document.getElementById("library-search-status")?.textContent ?? "";
    if (searchingStatus && currentStatus && currentStatus !== searchingStatus) {
      settledWithoutResults = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return {
    ids,
    titles: [...document.querySelectorAll(".bookmark-option-title")]
      .map(({ textContent }) => textContent),
    status: document.getElementById("library-search-status")?.textContent ?? "",
    searchingStatus,
    settledWithoutResults,
    inferenceMilliseconds: performance.now() - startedAt,
  };
})()
`;

const removeScenario = String.raw`
(async () => {
  document.getElementById("semantic-remove").click();
  const deadline = Date.now() + 10000;
  let state;
  while (Date.now() < deadline) {
    state = (await chrome.storage.local.get("semanticSearchState"))
      .semanticSearchState?.state;
    if (state?.modelStatus === "notInstalled" && state?.consentGrantedAt === null) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return {
    state,
    cacheNames: await caches.keys(),
    databases: typeof indexedDB.databases === "function"
      ? (await indexedDB.databases()).map(({ name }) => name)
      : [],
  };
})()
`;

function assertGateResult(before, installed, offline, removed) {
  if (before.disclosureAccepted !== true) {
    throw new Error(`First-use disclosure was not accepted: ${JSON.stringify(before)}`);
  }
  if (
    before.beforeStateStored ||
    before.beforeCaches.includes(CACHE_KEY) ||
    before.beforeDatabases.includes("bookmark-x-semantic")
  ) {
    throw new Error(`Pre-consent semantic data exists: ${JSON.stringify(before)}`);
  }
  if (
    !before.restored?.ok ||
    before.restored.data?.bookmarks !== syntheticBookmarks.length
  ) {
    throw new Error(
      `Synthetic corpus restore failed: ${JSON.stringify(before.restored)}`,
    );
  }
  if (
    installed.state.backend !== "wasm" ||
    installed.state.modelStatus !== "ready" ||
    installed.state.indexedBookmarks !== syntheticBookmarks.length ||
    typeof installed.state.consentGrantedAt !== "string"
  ) {
    throw new Error(
      `WASM install state is invalid: ${JSON.stringify(installed.state)}`,
    );
  }
  if (!installed.cacheNames.includes(CACHE_KEY)) {
    throw new Error("The Transformers.js browser cache was not created.");
  }
  const expectedAssetFragments = [
    "/config.json",
    "/tokenizer_config.json",
    "/tokenizer.json",
    "/onnx/model_quantized.onnx",
  ];
  for (const fragment of expectedAssetFragments) {
    if (
      !installed.cachedRequests.some(
        (url) => url.includes(`/${MODEL_REVISION}`) && url.includes(fragment),
      )
    ) {
      throw new Error(`Pinned browser cache is missing ${fragment}.`);
    }
  }
  if (
    installed.index.dimensions !== 384 ||
    installed.index.entries.length !== syntheticBookmarks.length ||
    installed.index.entries.some(
      (entry) =>
        entry.dimensions !== 384 ||
        !entry.finite ||
        !/^[a-f0-9]{64}$/u.test(entry.fingerprint),
    )
  ) {
    throw new Error(`Semantic index is invalid: ${JSON.stringify(installed.index)}`);
  }
  if (!installed.lexical?.ok || installed.lexical.data?.total !== 0) {
    throw new Error(
      `The semantic probe query unexpectedly had lexical hits: ${JSON.stringify(installed.lexical)}`,
    );
  }
  if (offline.ids[0] !== EXPECTED_BOOKMARK_ID) {
    throw new Error(
      `Offline semantic retrieval missed the expected bookmark: ${JSON.stringify(offline)}`,
    );
  }
  if (
    removed.state?.modelStatus !== "notInstalled" ||
    removed.state?.consentGrantedAt !== null ||
    removed.cacheNames.includes(CACHE_KEY) ||
    removed.databases.includes("bookmark-x-semantic")
  ) {
    throw new Error(`Semantic removal was incomplete: ${JSON.stringify(removed)}`);
  }
}

async function stopChrome(chromeProcess) {
  if (chromeProcess.exitCode !== null || chromeProcess.signalCode !== null) return;
  chromeProcess.kill("SIGTERM");
  const exited = once(chromeProcess, "exit");
  const graceful = await Promise.race([
    exited.then(() => true),
    delay(5_000).then(() => false),
  ]);
  if (
    !graceful &&
    chromeProcess.exitCode === null &&
    chromeProcess.signalCode === null
  ) {
    chromeProcess.kill("SIGKILL");
    await once(chromeProcess, "exit");
  }
}

export async function runBrowserGate(options) {
  await access(resolve(DIST_DIRECTORY, "manifest.json"));
  const chromeBinary = await findChromeBinary();
  const profileDirectory = await mkdtemp(
    resolve(tmpdir(), "bookmark-x-semantic-chrome-"),
  );
  // Headless Chrome cannot surface or accept the native optional-permission
  // prompt. The production manifest is validated above, then only this isolated
  // runtime copy receives the model hosts so the real click path can proceed.
  const extensionDirectory = await stageHeadlessGateExtension(profileDirectory);
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
      `--disable-extensions-except=${extensionDirectory}`,
      `--load-extension=${extensionDirectory}`,
      "--remote-debugging-port=0",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  chromeProcess.stderr.setEncoding("utf8");
  chromeProcess.stderr.on("data", (chunk) => {
    chromeErrors.push(chunk);
    if (chromeErrors.length > 40) chromeErrors.shift();
  });

  let optionsDevTools;
  let popupDevTools;
  let browserMonitor;
  let stopWorkerMonitor = false;
  const workerDiagnostics = [];
  let workerMonitor;
  try {
    const port = await waitForDevToolsPort(profileDirectory);
    const extensionWorker = await waitForExtensionWorker(port);
    const extensionId = new URL(extensionWorker.url).host;
    const optionsTarget = await openTarget(port, "about:blank");
    optionsDevTools = await connectDevTools(optionsTarget.webSocketDebuggerUrl);
    await optionsDevTools.send("Runtime.enable");
    await optionsDevTools.send("Page.enable");
    await optionsDevTools.send("Network.enable");
    const modelRequests = [];
    browserMonitor = await connectBrowserMonitor(
      port,
      workerDiagnostics,
      modelRequests,
    );
    await enableChildWorkerDebugger(optionsDevTools, workerDiagnostics, modelRequests);
    optionsDevTools.on("Network.requestWillBeSent", ({ request }) => {
      if (/huggingface\.co|cdn\.hf\.co/u.test(request?.url ?? "")) {
        modelRequests.push(request.url);
      }
    });
    await optionsDevTools.send("Page.navigate", {
      url: `chrome-extension://${extensionId}/options.html`,
    });
    await delay(500);

    const before = await evaluate(optionsDevTools, seedScenario, "pre-consent/seed");
    if (modelRequests.length !== 0) {
      throw new Error(
        `Model network request occurred before consent: ${modelRequests[0]}`,
      );
    }
    console.log(
      "pre-consent passed: no state, semantic index, model cache, or model request",
    );

    workerMonitor = monitorWorkerTargets(
      port,
      () => stopWorkerMonitor,
      workerDiagnostics,
    );
    let installed;
    try {
      installed = await evaluate(
        optionsDevTools,
        installScenario(options.timeoutMs),
        "consent/install/index",
        true,
      );
    } catch (error) {
      const requests = modelRequests.length
        ? `\nmodel requests observed:\n${[
            ...new Set(
              modelRequests.map((value) => {
                const url = new URL(value);
                return `${url.origin}${url.pathname}`;
              }),
            ),
          ].join("\n")}`
        : "\nno model requests observed by the options target";
      const workers = workerDiagnostics.length
        ? `\nsemantic worker diagnostics:\n${workerDiagnostics.join("\n")}`
        : "\nno semantic worker exception was exposed over CDP";
      throw new Error(`${error.message}${requests}${workers}`);
    } finally {
      stopWorkerMonitor = true;
      await workerMonitor;
    }
    console.log(
      `install ready: backend ${installed.state.backend}, ${installed.index.entries.length} indexed, ` +
        `${Math.round(installed.timings.totalInstallMilliseconds)} ms total`,
    );

    const popupTarget = await openTarget(port, "about:blank");
    popupDevTools = await connectDevTools(popupTarget.webSocketDebuggerUrl);
    await popupDevTools.send("Runtime.enable");
    await popupDevTools.send("Network.enable");
    const offlineModelRequests = [];
    popupDevTools.on("Network.requestWillBeSent", ({ request }) => {
      if (/huggingface\.co|cdn\.hf\.co/u.test(request?.url ?? "")) {
        offlineModelRequests.push(request.url);
      }
    });
    await enableChildWorkerDebugger(
      popupDevTools,
      workerDiagnostics,
      offlineModelRequests,
    );
    await popupDevTools.send("Network.emulateNetworkConditions", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
    await popupDevTools.send("Page.enable");
    await popupDevTools.send("Page.navigate", {
      url: `chrome-extension://${extensionId}/popup.html`,
    });
    const offline = await evaluate(
      popupDevTools,
      offlineSearchScenario(options.timeoutMs),
      "offline cache/retrieval",
    );
    if (offline.ids.length === 0) {
      throw new Error(
        `Offline semantic search returned no results: ${JSON.stringify(offline)}\n` +
          workerDiagnostics.slice(-20).join("\n"),
      );
    }
    if (offlineModelRequests.length !== 0) {
      throw new Error(
        `Offline reuse attempted a model request: ${offlineModelRequests[0]}`,
      );
    }
    console.log(
      `offline cache reuse passed: bookmark ${offline.ids[0]} ranked first in ` +
        `${Math.round(offline.inferenceMilliseconds)} ms`,
    );

    await popupDevTools.send("Page.navigate", { url: "about:blank" });
    await delay(250);
    const removed = await evaluate(optionsDevTools, removeScenario, "remove");
    assertGateResult(before, installed, offline, removed);
    console.log("remove passed: cache, index, consent, and enabled state cleared");
    return {
      backend: installed.state.backend,
      cacheEntries: installed.cachedRequests.length,
      indexedBookmarks: installed.index.entries.length,
      modelRequestsObserved: modelRequests.length,
      downloadAndLoadMilliseconds: Math.round(
        installed.timings.downloadAndLoadMilliseconds ??
          installed.timings.totalInstallMilliseconds,
      ),
      indexingMilliseconds:
        installed.timings.indexingMilliseconds === null
          ? null
          : Math.round(installed.timings.indexingMilliseconds),
      totalInstallMilliseconds: Math.round(installed.timings.totalInstallMilliseconds),
      offlineInferenceMilliseconds: Math.round(offline.inferenceMilliseconds),
      expectedBookmarkId: EXPECTED_BOOKMARK_ID,
      profileDirectory,
    };
  } catch (error) {
    const diagnostics = chromeErrors.join("").trim();
    if (diagnostics) console.error(diagnostics.split("\n").slice(-30).join("\n"));
    throw error;
  } finally {
    stopWorkerMonitor = true;
    await workerMonitor?.catch(() => undefined);
    browserMonitor?.close();
    popupDevTools?.close();
    optionsDevTools?.close();
    await stopChrome(chromeProcess);
    if (!options.keepProfile) {
      await rm(profileDirectory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    }
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.run) {
    console.log(
      "dry-run: real Chrome semantic gate is opt-in; pass --run to download the pinned model",
    );
    return;
  }
  const result = await runBrowserGate(options);
  console.log(`semantic browser gate passed: ${JSON.stringify(result)}`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
