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

  it("binds dispatched CI to the prepared ref and exact SHA", async () => {
    const workflow = await readWorkflow("ci.yml");

    expect(workflow).toContain("expected_sha:");
    expect(workflow).toContain("scripts/release-dispatch-policy.mjs validate");
    expect(workflow).toContain('--event-sha "$TRIGGER_RELEASE_SHA"');
  });

  it("runs CI for ordinary PRs that only change package metadata", async () => {
    const workflow = await readWorkflow("ci.yml");
    const pullRequestTrigger = workflow.slice(
      workflow.indexOf("  pull_request:\n"),
      workflow.indexOf("  workflow_dispatch:\n"),
    );

    expect(pullRequestTrigger).not.toContain("paths-ignore:");
  });

  it("makes automation PR and dispatch runs validate the same head SHA", async () => {
    const workflow = await readWorkflow("ci.yml");

    expect(workflow).toContain(
      "group: ci-${{ github.workflow }}-${{ github.head_ref || github.ref_name }}",
    );
    expect(workflow).toContain("cancel-in-progress: true");
    expect(workflow).toContain(
      "ref: ${{ inputs.expected_sha || (startsWith(github.head_ref, 'automation/prepare-v') && github.event.pull_request.head.sha) || github.sha }}",
    );
    expect(workflow).toContain(
      "EXPECTED_RELEASE_SHA: ${{ inputs.expected_sha || github.event.pull_request.head.sha }}",
    );
    expect(workflow).toContain(
      "RELEASE_REF_NAME: ${{ github.head_ref || github.ref_name }}",
    );
    expect(workflow).toContain(
      "TRIGGER_RELEASE_SHA: ${{ github.event_name == 'workflow_dispatch' && github.sha || github.event.pull_request.head.sha }}",
    );
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
