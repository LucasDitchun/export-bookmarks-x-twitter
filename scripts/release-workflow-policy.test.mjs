import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const rootDirectory = resolve(import.meta.dirname, "..");

async function readWorkflow(name) {
  return readFile(resolve(rootDirectory, ".github", "workflows", name), "utf8");
}

function workflowEvents(workflow) {
  const start = workflow.indexOf("on:\n");
  const end = workflow.indexOf("\npermissions:", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return workflow.slice(start, end);
}

describe("lean CI and staging policy", () => {
  it("keeps develop free from automatic GitHub Actions", async () => {
    const ci = await readWorkflow("ci.yml");
    const events = workflowEvents(ci);

    expect(events).toContain("workflow_dispatch:");
    expect(events).not.toContain("pull_request:");
    expect(events).not.toContain("push:");
    expect(ci).toContain("expected_sha:");
    expect(ci).toContain("pnpm verify:local");
    expect(ci).not.toContain("pnpm verify:staging");
  });

  it("runs the complete remote gate once when a develop batch is staged", async () => {
    const staging = await readWorkflow("release-train.yml");
    const events = workflowEvents(staging);

    expect(events).toContain("workflow_dispatch:");
    expect(events).not.toContain("pull_request:");
    expect(events).not.toContain("push:");
    expect(staging).toContain("refs/heads/develop");
    expect(staging).toContain("cancel-in-progress: true");
    expect(staging.match(/pnpm verify:staging/gu)).toHaveLength(1);
    expect(staging.match(/pnpm install --frozen-lockfile/gu)).toHaveLength(1);
    expect(staging).not.toContain("pnpm test:coverage");
    expect(staging).not.toContain("pnpm build");
    expect(staging).not.toContain("pnpm smoke:chrome");
    expect(staging.indexOf("release-train.mjs prepare")).toBeLessThan(
      staging.indexOf("pnpm verify:staging"),
    );
  });

  it("publishes the verified snapshot directly to staging without another CI run", async () => {
    const staging = await readWorkflow("release-train.yml");

    expect(staging).toContain('"refs/heads/staging"');
    expect(staging).toContain("download/bookmark-x.zip");
    expect(staging).toContain("public/manifest.json");
    expect(staging).toContain("CHANGELOG.md");
    expect(staging).toContain('git diff --exit-code "$SOURCE_SHA"');
    expect(staging).not.toContain("gh pr create");
    expect(staging).not.toContain("workflow run");
  });

  it("isolates write permission from every command that executes repository dependencies", async () => {
    const staging = await readWorkflow("release-train.yml");
    const publishStart = staging.indexOf("  publish-staging:\n");
    expect(publishStart).toBeGreaterThan(0);
    const validation = staging.slice(0, publishStart);
    const publication = staging.slice(publishStart);

    expect(validation).toContain("contents: read");
    expect(validation).not.toContain("contents: write");
    expect(publication).toContain("contents: write");
    expect(publication).not.toContain("pnpm install");
    expect(publication).not.toContain("pnpm verify:");
    expect(publication).not.toContain("pnpm build");
  });

  it("allows main promotion only from the reviewed staging branch without rebuilding", async () => {
    const promotion = await readWorkflow("promote-release.yml");

    expect(promotion).toContain('"$HEAD_REF" != "staging"');
    expect(promotion).toContain('"$BASE_REF" != "main"');
    expect(promotion).not.toContain('"$HEAD_REF" != "develop"');
    for (const expensiveCommand of [
      "pnpm install",
      "pnpm test",
      "pnpm lint",
      "pnpm typecheck",
      "pnpm build",
      "pnpm package",
      "pnpm smoke:chrome",
    ]) {
      expect(promotion).not.toContain(expensiveCommand);
    }
  });

  it("pins third-party actions and starts every workflow with minimum permissions", async () => {
    const workflows = await Promise.all(
      ["ci.yml", "release-train.yml", "promote-release.yml"].map(readWorkflow),
    );

    for (const workflow of workflows) {
      expect(workflow).toMatch(/permissions:(?: \{\}|\n  contents: read)/u);
      for (const line of workflow.split("\n")) {
        const action = line.match(/uses:\s+[^@\s]+@([^\s#]+)/u)?.[1];
        if (action) {
          expect(action).toMatch(/^[0-9a-f]{40}$/u);
        }
      }
    }
  });
});
