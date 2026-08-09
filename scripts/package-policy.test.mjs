import { describe, expect, it } from "vitest";

import {
  EXPECTED_CONTENT_SCRIPT_MATCHES,
  EXPECTED_MINIMUM_CHROME_VERSION,
  EXPECTED_MANIFEST_HOST_PERMISSIONS,
  EXPECTED_MANIFEST_PERMISSIONS,
  EXPECTED_OPTIONS_PAGE,
  EXPECTED_SIDE_PANEL_PATH,
  validateManifestEntrypoints,
  validateExactStringArray,
} from "./package-policy.mjs";

describe("content script host policy", () => {
  it("allows exactly the two X hosts in any order", () => {
    expect(EXPECTED_CONTENT_SCRIPT_MATCHES).toEqual([
      "https://x.com/*",
      "https://www.x.com/*",
    ]);
    expect(() =>
      validateExactStringArray(
        ["https://www.x.com/*", "https://x.com/*"],
        EXPECTED_CONTENT_SCRIPT_MATCHES,
        "content_scripts[0].matches",
      ),
    ).not.toThrow();
  });

  it.each([
    ["all URLs", ["<all_urls>"]],
    ["Twitter", ["https://twitter.com/*", "https://www.twitter.com/*"]],
    [
      "an extra host",
      ["https://x.com/*", "https://www.x.com/*", "https://example.com/*"],
    ],
  ])("rejects %s", (_label, matches) => {
    expect(() =>
      validateExactStringArray(
        matches,
        EXPECTED_CONTENT_SCRIPT_MATCHES,
        "content_scripts[0].matches",
      ),
    ).toThrow(
      "Manifest content_scripts[0].matches must be exactly: https://www.x.com/*, https://x.com/*.",
    );
  });
});

describe("extension package permission policy", () => {
  it("requires the minimal Side Panel permission set in any order", () => {
    expect(EXPECTED_MANIFEST_PERMISSIONS).toEqual([
      "activeTab",
      "sidePanel",
      "storage",
      "unlimitedStorage",
    ]);
    expect(() =>
      validateExactStringArray(
        ["storage", "sidePanel", "unlimitedStorage", "activeTab"],
        EXPECTED_MANIFEST_PERMISSIONS,
        "permissions",
      ),
    ).not.toThrow();
  });

  it("rejects a package that omits the required sidePanel permission", () => {
    expect(() =>
      validateExactStringArray(
        ["activeTab", "storage", "unlimitedStorage"],
        EXPECTED_MANIFEST_PERMISSIONS,
        "permissions",
      ),
    ).toThrow(
      "Manifest permissions must be exactly: activeTab, sidePanel, storage, unlimitedStorage.",
    );
  });

  it("rejects every permission outside the exact allowlist", () => {
    expect(() =>
      validateExactStringArray(
        [...EXPECTED_MANIFEST_PERMISSIONS, "tabs"],
        EXPECTED_MANIFEST_PERMISSIONS,
        "permissions",
      ),
    ).toThrow(
      "Manifest permissions must be exactly: activeTab, sidePanel, storage, unlimitedStorage.",
    );
  });

  it("allows only GitHub plus the pinned model host and its data CDN", () => {
    expect(EXPECTED_MANIFEST_HOST_PERMISSIONS).toEqual([
      "https://api.github.com/*",
      "https://huggingface.co/*",
      "https://*.cdn.hf.co/*",
    ]);
    expect(() =>
      validateExactStringArray(
        [
          "https://*.cdn.hf.co/*",
          "https://api.github.com/*",
          "https://huggingface.co/*",
        ],
        EXPECTED_MANIFEST_HOST_PERMISSIONS,
        "host_permissions",
      ),
    ).not.toThrow();
  });

  it.each([
    { permissions: [] },
    { permissions: ["https://github.com/"] },
    { permissions: ["https://huggingface.co/"] },
    { permissions: [...EXPECTED_MANIFEST_HOST_PERMISSIONS, "https://x.com/*"] },
    { permissions: ["<all_urls>"] },
  ])(
    "rejects missing, path-wildcard, and broad host access: $permissions",
    ({ permissions }) => {
      expect(() =>
        validateExactStringArray(
          permissions,
          EXPECTED_MANIFEST_HOST_PERMISSIONS,
          "host_permissions",
        ),
      ).toThrow(
        "Manifest host_permissions must be exactly: https://*.cdn.hf.co/*, https://api.github.com/*, https://huggingface.co/*.",
      );
    },
  );
});

describe("extension package entrypoint policy", () => {
  const validManifest = {
    minimum_chrome_version: "116",
    side_panel: { default_path: "sidepanel.html" },
    options_ui: { page: "options.html", open_in_tab: true },
  };

  it("pins Chrome 116 and the shared options and Side Panel pages", () => {
    expect(EXPECTED_MINIMUM_CHROME_VERSION).toBe("116");
    expect(EXPECTED_SIDE_PANEL_PATH).toBe("sidepanel.html");
    expect(EXPECTED_OPTIONS_PAGE).toBe("options.html");
    expect(() => validateManifestEntrypoints(validManifest)).not.toThrow();
  });

  it.each([
    ["minimum Chrome", { ...validManifest, minimum_chrome_version: "102" }],
    ["Side Panel", { ...validManifest, side_panel: { default_path: "popup.html" } }],
    ["options page", { ...validManifest, options_ui: { page: "missing.html" } }],
    [
      "options tab behavior",
      { ...validManifest, options_ui: { page: "options.html", open_in_tab: false } },
    ],
  ])("rejects an invalid %s contract", (_label, manifest) => {
    expect(() => validateManifestEntrypoints(manifest)).toThrow();
  });
});
