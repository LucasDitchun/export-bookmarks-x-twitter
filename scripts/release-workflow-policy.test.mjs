import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const rootDirectory = resolve(import.meta.dirname, "..");

async function readWorkflow(name) {
  return readFile(resolve(rootDirectory, ".github", "workflows", name), "utf8");
}

function jobSection(workflow, jobName, nextJobName) {
  const start = workflow.indexOf(`  ${jobName}:\n`);
  const end = workflow.indexOf(`  ${nextJobName}:\n`, start + 1);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return workflow.slice(start, end);
}

describe("release workflow permissions and gates", () => {
  it("isolates workflow dispatch to an actions-only job", async () => {
    const workflow = await readWorkflow("release-train.yml");
    const publication = jobSection(
      workflow,
      "open-prepared-release-pr",
      "dispatch-prepared-release-ci",
    );
    const dispatch = jobSection(
      workflow,
      "dispatch-prepared-release-ci",
      "wrong-branch",
    );

    expect(publication).toContain("      actions: read\n");
    expect(dispatch).toMatch(/permissions:\n      actions: write\n    steps:/u);
    expect(dispatch).not.toMatch(/contents:|pull-requests:/u);
    expect(dispatch).toContain('--field expected_sha="$PREPARED_SHA"');
  });

  it("binds manual CI to the prepared ref and exact SHA", async () => {
    const workflow = await readWorkflow("ci.yml");

    expect(workflow).toContain("expected_sha:");
    expect(workflow).toContain("scripts/release-dispatch-policy.mjs validate");
    expect(workflow).toContain('--event-sha "$DISPATCH_EVENT_SHA"');
    expect(workflow).toContain("ref: ${{ inputs.expected_sha || github.sha }}");
  });

  it("keeps prepared release PR runs from racing their exact-SHA dispatch", async () => {
    const workflow = await readWorkflow("ci.yml");
    const pullRequestTrigger = workflow.slice(
      workflow.indexOf("  pull_request:\n"),
      workflow.indexOf("  workflow_dispatch:\n"),
    );

    const ignoredPaths = pullRequestTrigger
      .slice(pullRequestTrigger.indexOf("    paths-ignore:\n"))
      .match(/^      - (.+)$/gmu)
      ?.map((line) => line.slice("      - ".length));
    expect(ignoredPaths).toEqual([
      "CHANGELOG.md",
      "download/bookmark-x.zip",
      "package.json",
      "pnpm-lock.yaml",
      "public/manifest.json",
    ]);
    expect(workflow).toContain(
      "group: ci-${{ github.workflow }}-${{ inputs.expected_sha || github.sha }}",
    );
    expect(workflow).not.toContain("github.head_ref || github.ref_name");
  });

  it("runs Chrome smoke once at preparation and never rebuilds main", async () => {
    const [ci, preparation, promotion] = await Promise.all([
      readWorkflow("ci.yml"),
      readWorkflow("release-train.yml"),
      readWorkflow("promote-release.yml"),
    ]);

    expect(ci).not.toContain("pnpm smoke:chrome");
    expect(preparation.match(/pnpm smoke:chrome/gu)).toHaveLength(1);
    expect(promotion).not.toMatch(/pnpm (?:build|package|smoke:chrome)/u);
  });

  it("audits all dependencies in CI and release preparation", async () => {
    const [ci, preparation] = await Promise.all([
      readWorkflow("ci.yml"),
      readWorkflow("release-train.yml"),
    ]);

    expect(ci.match(/pnpm audit:high/gu)).toHaveLength(1);
    expect(preparation.match(/pnpm audit:high/gu)).toHaveLength(1);
  });
});
