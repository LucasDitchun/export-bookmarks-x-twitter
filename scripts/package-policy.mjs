export const EXPECTED_MANIFEST_PERMISSIONS = Object.freeze([
  "activeTab",
  "sidePanel",
  "storage",
  "unlimitedStorage",
]);

export const EXPECTED_MANIFEST_HOST_PERMISSIONS = Object.freeze([
  "https://api.github.com/*",
]);

export const EXPECTED_MANIFEST_OPTIONAL_HOST_PERMISSIONS = Object.freeze([
  "https://huggingface.co/*",
  "https://*.cdn.hf.co/*",
]);

export const EXPECTED_CONTENT_SCRIPT_MATCHES = Object.freeze([
  "https://x.com/*",
  "https://www.x.com/*",
]);

export const EXPECTED_MINIMUM_CHROME_VERSION = "116";
export const EXPECTED_SIDE_PANEL_PATH = "sidepanel.html";
export const EXPECTED_OPTIONS_PAGE = "options.html";

export const REQUIRED_LEGAL_RELEASE_FILES = Object.freeze([
  "THIRD_PARTY_NOTICES.md",
  "THIRD_PARTY_LICENSES/huggingface-transformers-Apache-2.0.txt",
  "THIRD_PARTY_LICENSES/onnxruntime-web-MIT.txt",
  "THIRD_PARTY_LICENSES/multilingual-e5-small-MIT.txt",
]);

export const SEMANTIC_RUNTIME_ASSETS = Object.freeze([
  Object.freeze({
    label: "ONNX Runtime loader",
    pattern: /^assets\/ort-wasm-simd-threaded\.asyncify-[A-Za-z0-9_-]+\.mjs$/u,
  }),
  Object.freeze({
    label: "ONNX Runtime WASM binary",
    pattern: /^assets\/ort-wasm-simd-threaded\.asyncify-[A-Za-z0-9_-]+\.wasm$/u,
  }),
  Object.freeze({
    label: "semantic worker",
    pattern: /^assets\/semantic-worker-[A-Za-z0-9_-]+\.js$/u,
  }),
]);

export function validateSemanticRuntimeAssets(filePaths) {
  for (const { label, pattern } of SEMANTIC_RUNTIME_ASSETS) {
    const matchingFiles = filePaths.filter((filePath) => pattern.test(filePath));
    if (matchingFiles.length !== 1) {
      throw new Error(
        `Packaged semantic search must contain exactly one ${label}; found ${matchingFiles.length}.`,
      );
    }
  }
}

export function validateOnnxRuntimeMetadata({ packageJson, lockfile, notices }) {
  const expectedVersion = packageJson?.dependencies?.["onnxruntime-web"];
  if (
    typeof expectedVersion !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(expectedVersion)
  ) {
    throw new Error(
      "package.json must pin onnxruntime-web to one exact semantic version.",
    );
  }

  const noticeVersions = [...notices.matchAll(/^## onnxruntime-web ([^\n]+)$/gmu)].map(
    ([, version]) => version.trim(),
  );
  if (noticeVersions.length !== 1 || noticeVersions[0] !== expectedVersion) {
    throw new Error(
      `THIRD_PARTY_NOTICES.md must name onnxruntime-web ${expectedVersion} exactly once.`,
    );
  }

  const lockedVersions = [
    ...new Set(
      [...lockfile.matchAll(/^  "?onnxruntime-web@([^":\n]+)"?:/gmu)].map(
        ([, version]) => version,
      ),
    ),
  ].sort();
  if (lockedVersions.length !== 1 || lockedVersions[0] !== expectedVersion) {
    const found = lockedVersions.length > 0 ? lockedVersions.join(", ") : "none";
    throw new Error(
      `pnpm-lock.yaml must resolve exactly onnxruntime-web ${expectedVersion}; found ${found}.`,
    );
  }
}

export function validateReleaseLegalFiles(filePaths) {
  const releaseFiles = new Set(filePaths);
  for (const requiredFile of REQUIRED_LEGAL_RELEASE_FILES) {
    if (!releaseFiles.has(requiredFile)) {
      throw new Error(`Release legal file is missing: ${requiredFile}`);
    }
  }
  for (const filePath of releaseFiles) {
    if (/sharp|libvips/iu.test(filePath)) {
      throw new Error(`Node-only release file is forbidden: ${filePath}`);
    }
  }
}

export function validateExactStringArray(actual, expected, fieldName) {
  if (!Array.isArray(actual) || actual.some((value) => typeof value !== "string")) {
    throw new Error(`Manifest ${fieldName} must be an array of strings.`);
  }

  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  if (
    sortedActual.length !== sortedExpected.length ||
    sortedActual.some((value, index) => value !== sortedExpected[index])
  ) {
    throw new Error(
      `Manifest ${fieldName} must be exactly: ${sortedExpected.join(", ")}.`,
    );
  }
}

export function validateManifestEntrypoints(manifest) {
  if (manifest.minimum_chrome_version !== EXPECTED_MINIMUM_CHROME_VERSION) {
    throw new Error(
      `Manifest minimum_chrome_version must be ${EXPECTED_MINIMUM_CHROME_VERSION}.`,
    );
  }
  if (manifest.side_panel?.default_path !== EXPECTED_SIDE_PANEL_PATH) {
    throw new Error(
      `Manifest side_panel.default_path must be ${EXPECTED_SIDE_PANEL_PATH}.`,
    );
  }
  if (manifest.options_ui?.page !== EXPECTED_OPTIONS_PAGE) {
    throw new Error(`Manifest options_ui.page must be ${EXPECTED_OPTIONS_PAGE}.`);
  }
  if (manifest.options_ui?.open_in_tab !== true) {
    throw new Error("Manifest options_ui.open_in_tab must be true.");
  }
}
