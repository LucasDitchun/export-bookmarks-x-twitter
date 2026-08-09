import { describe, expect, it } from "vitest";

import {
  EXPECTED_MANIFEST_PERMISSIONS,
  validateExactStringArray,
} from "./package-policy.mjs";

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
});
