import { describe, expect, it } from "vitest";

import { VERIFICATION_PROFILES } from "./verification-plan.mjs";

function labels(profile) {
  return profile.map(({ label }) => label);
}

describe("verification plan", () => {
  it("keeps the local feedback loop useful without release-only work", () => {
    expect(labels(VERIFICATION_PROFILES.local)).toEqual([
      "format",
      "lint",
      "typecheck",
      "tests",
      "build",
    ]);
    expect(JSON.stringify(VERIFICATION_PROFILES.local)).not.toMatch(
      /coverage|audit|semantic-model:gate|package|smoke/iu,
    );
  });

  it("owns every expensive staging gate in one ordered profile", () => {
    expect(labels(VERIFICATION_PROFILES.staging)).toEqual([
      "audit",
      "format",
      "lint",
      "typecheck",
      "release-policy",
      "semantic-contracts",
      "coverage",
      "build",
      "semantic-model",
      "package",
      "chrome-smoke",
    ]);
  });

  it("does not execute build, package, coverage, or Chrome smoke twice", () => {
    const commands = VERIFICATION_PROFILES.staging.flatMap(({ commands }) =>
      commands.map(({ arguments: arguments_ }) => arguments_.join(" ")),
    );
    for (const command of ["test:coverage", "build", "package", "smoke:chrome"]) {
      expect(commands.filter((candidate) => candidate === command)).toHaveLength(1);
    }
  });
});
