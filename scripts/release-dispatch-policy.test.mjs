import { describe, expect, it } from "vitest";

import { assertReleaseDispatchIdentity } from "./release-dispatch-policy.mjs";

describe("release CI dispatch identity policy", () => {
  const sha = "a".repeat(40);

  it("accepts the exact prepared release ref and commit", () => {
    expect(() =>
      assertReleaseDispatchIdentity({
        actualSha: sha,
        expectedSha: sha,
        refName: "automation/prepare-v0.1.1",
      }),
    ).not.toThrow();
  });

  it.each([
    "develop",
    "main",
    "feature/prepare-v0.1.1",
    "automation/prepare-v0.1",
    "automation/prepare-v01.1.1",
  ])("rejects arbitrary dispatch ref %s", (refName) => {
    expect(() =>
      assertReleaseDispatchIdentity({ actualSha: sha, expectedSha: sha, refName }),
    ).toThrow("Release CI may only be dispatched for a prepared release branch");
  });

  it("rejects a missing, malformed, or stale expected SHA", () => {
    expect(() =>
      assertReleaseDispatchIdentity({
        actualSha: sha,
        expectedSha: "HEAD",
        refName: "automation/prepare-v0.1.1",
      }),
    ).toThrow("Expected release SHA must be a full lowercase commit SHA");
    expect(() =>
      assertReleaseDispatchIdentity({
        actualSha: "b".repeat(40),
        expectedSha: sha,
        refName: "automation/prepare-v0.1.1",
      }),
    ).toThrow("Dispatched release SHA does not match");
  });
});
