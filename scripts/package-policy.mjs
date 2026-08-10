export const EXPECTED_MANIFEST_PERMISSIONS = Object.freeze([
  "activeTab",
  "sidePanel",
  "storage",
  "unlimitedStorage",
]);

export const EXPECTED_MANIFEST_HOST_PERMISSIONS = Object.freeze([
  "https://api.github.com/*",
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
