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
  it("routes CI and packaging through one canonical two-stage build gate", async () => {
    const [packageJsonText, ci, preparation] = await Promise.all([
      readFile(resolve(rootDirectory, "package.json"), "utf8"),
      readWorkflow("ci.yml"),
      readWorkflow("release-train.yml"),
    ]);
    const packageJson = JSON.parse(packageJsonText);

    expect(packageJson.scripts.build).toBe(
      "vite build && vite build --config vite.content-script.config.ts && node scripts/validate-content-script-bundle.mjs",
    );
    expect(packageJson.scripts.package).toBe("node scripts/package.mjs");
    for (const workflow of [ci, preparation]) {
      expect(workflow.match(/pnpm build/gu)).toHaveLength(1);
      expect(workflow).not.toContain("vite.content-script.config.ts");
      expect(workflow).not.toContain("validate-content-script-bundle.mjs");
    }
  });

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

  it("warms one reusable develop cache without running the quality suite", async () => {
    const workflow = await readWorkflow("ci.yml");

    expect(workflow).toContain("  push:\n    branches:\n      - develop\n");
    expect(workflow).toContain("      - pnpm-lock.yaml\n");
    expect(workflow).toContain("      - .github/workflows/ci.yml\n");
    expect(workflow).toContain("if: github.event_name == 'push'");
    expect(workflow).toContain("run: pnpm fetch --frozen-lockfile");
    expect(workflow).toContain("if: github.event_name != 'push'");
  });

  it("uses one full PR gate and a smaller artifact-only release gate", async () => {
    const workflow = await readWorkflow("ci.yml");

    expect(workflow).toContain("CI_MODE:");
    expect(workflow).toContain("if: env.CI_MODE == 'full'");
    expect(workflow).toContain(
      "pnpm exec prettier --check package.json pnpm-lock.yaml public/manifest.json CHANGELOG.md",
    );
    expect(workflow.match(/pnpm lint/gu)).toHaveLength(1);
    expect(workflow.match(/pnpm typecheck/gu)).toHaveLength(1);
    expect(workflow.match(/pnpm test:coverage/gu)).toHaveLength(1);
    expect(workflow.match(/pnpm build/gu)).toHaveLength(1);
    expect(workflow.match(/pnpm package/gu)).toHaveLength(1);
    expect(workflow.match(/pnpm verify:archive/gu)).toHaveLength(1);
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

  it("does not repeat source validation while preparing reviewed artifacts", async () => {
    const preparation = await readWorkflow("release-train.yml");

    expect(preparation).not.toMatch(/pnpm (?:lint|typecheck|test:coverage)/u);
    expect(preparation).toContain(
      "pnpm exec prettier --check package.json pnpm-lock.yaml public/manifest.json CHANGELOG.md",
    );
    expect(preparation).toContain("pnpm install --frozen-lockfile --prefer-offline");
    expect(preparation).toContain("pnpm install --lockfile-only --offline");
    expect(preparation).toContain("compression-level: 0");
  });

  it("uses the current LTS runtime consistently", async () => {
    const [ci, preparation, nodeVersion] = await Promise.all([
      readWorkflow("ci.yml"),
      readWorkflow("release-train.yml"),
      readFile(resolve(rootDirectory, ".node-version"), "utf8"),
    ]);

    expect(nodeVersion.trim()).toBe("24");
    for (const workflow of [ci, preparation]) {
      expect(workflow).not.toContain("node-version:");
      expect(workflow).toContain("node-version-file: .node-version");
    }
  });

  it("cancels only stale validation and sync work", async () => {
    const [preparation, promotion] = await Promise.all([
      readWorkflow("release-train.yml"),
      readWorkflow("promote-release.yml"),
    ]);

    expect(preparation).toContain(
      "group: bookmark-x-release-train-${{ github.event_name }}",
    );
    expect(preparation).toContain(
      "cancel-in-progress: ${{ github.event_name == 'push' }}",
    );
    expect(promotion).toContain(
      "cancel-in-progress: ${{ github.event.action != 'closed' }}",
    );
  });

  it("audits all dependencies in CI and release preparation", async () => {
    const [ci, preparation] = await Promise.all([
      readWorkflow("ci.yml"),
      readWorkflow("release-train.yml"),
    ]);

    expect(ci.match(/pnpm audit:high/gu)).toHaveLength(1);
    expect(preparation.match(/pnpm audit:high/gu)).toHaveLength(1);
  });

  it("formats the refreshed release lockfile before the formatting gate", async () => {
    const preparation = await readWorkflow("release-train.yml");
    const refresh = preparation.indexOf("pnpm install --lockfile-only");
    const formatLockfile = preparation.indexOf(
      "pnpm exec prettier --write pnpm-lock.yaml",
      refresh,
    );
    const formatCheck = preparation.indexOf(
      "pnpm exec prettier --check package.json pnpm-lock.yaml public/manifest.json CHANGELOG.md",
      refresh,
    );

    expect(refresh).toBeGreaterThanOrEqual(0);
    expect(formatLockfile).toBeGreaterThan(refresh);
    expect(formatCheck).toBeGreaterThan(formatLockfile);
  });
});
