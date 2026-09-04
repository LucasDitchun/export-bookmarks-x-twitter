import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const rootDirectory = resolve(import.meta.dirname, "..");
const stableReleaseUrl =
  "https://github.com/LucasDitchun/export-bookmarks-x-twitter/releases/latest/download/bookmark-x.zip";

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
  it("constrains dependency updates to supported compiler and runtime versions", async () => {
    const dependabot = await readFile(
      resolve(rootDirectory, ".github", "dependabot.yml"),
      "utf8",
    );

    expect(dependabot).toMatch(
      /dependency-name: typescript\n\s+# typescript-eslint does not support the TypeScript 7 API yet\.[\s\S]*?versions: \[">=7"\]/u,
    );
    expect(dependabot).toMatch(
      /dependency-name: "@types\/node"\n\s+# Keep Node types aligned with the Node 24 runtime used locally and in CI\.[\s\S]*?versions: \[">=25"\]/u,
    );
    const onnxRuntimeIgnore = dependabot.match(
      /- dependency-name: onnxruntime-web(?:\n {8}#.*)*/u,
    )?.[0];
    expect(onnxRuntimeIgnore).toContain(
      "Keep the direct runtime aligned with the version bundled by Transformers 4.2.",
    );
    expect(onnxRuntimeIgnore).toContain(
      "Update both together only after validating one packaged loader and WASM binary.",
    );
    expect(onnxRuntimeIgnore).not.toContain("versions:");
  });

  it("keeps contribution validation entirely local", async () => {
    const workflowNames = (
      await readdir(resolve(rootDirectory, ".github", "workflows"))
    )
      .filter((name) => name.endsWith(".yml"))
      .sort();

    expect(workflowNames).toEqual(["promote-release.yml", "release-train.yml"]);
  });

  it("keeps generated AI and Graphify artifacts local", async () => {
    const ignoreFile = await readFile(resolve(rootDirectory, ".gitignore"), "utf8");

    for (const localArtifact of [
      "graphify-out/",
      ".agents/",
      ".claude/",
      ".codex/",
      ".cursor/",
      "AGENTS.md",
      "CLAUDE.md",
      ".github/copilot-instructions.md",
    ]) {
      expect(ignoreFile).toContain(localArtifact);
    }
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

  it("configures the staging commit identity before Git may create a merge", async () => {
    const staging = await readWorkflow("release-train.yml");
    const identity = staging.indexOf('git config user.name "github-actions[bot]"');
    const merge = staging.indexOf('git merge --no-ff --no-commit "$SOURCE_SHA"');

    expect(identity).toBeGreaterThan(0);
    expect(merge).toBeGreaterThan(identity);
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

  it("publishes stable and versioned release assets from the same reviewed ZIP", async () => {
    const promotion = await readWorkflow("promote-release.yml");

    expect(promotion).toContain('archive="$RUNNER_TEMP/bookmark-x-$version.zip"');
    expect(promotion).toContain('stable_archive="$RUNNER_TEMP/bookmark-x.zip"');
    expect(promotion).toContain('cp download/bookmark-x.zip "$archive"');
    expect(promotion).toContain('cp download/bookmark-x.zip "$stable_archive"');
    expect(promotion).toContain(
      'echo "stable_archive=$stable_archive" >> "$GITHUB_OUTPUT"',
    );
    expect(promotion).toContain("STABLE_RELEASE_ARCHIVE:");
    expect(promotion).toContain(
      '"$STABLE_RELEASE_ARCHIVE#Bookmark X latest stable ZIP"',
    );
    expect(promotion).toContain(
      'validate_or_upload_asset "$STABLE_RELEASE_ARCHIVE" "Bookmark X latest stable ZIP"',
    );
  });

  it("points the canonical README download at the stable latest-release asset", async () => {
    const readme = await readFile(resolve(rootDirectory, "README.md"), "utf8");

    expect(readme).toContain(`](${stableReleaseUrl})`);
    expect(readme).not.toContain("](download/bookmark-x.zip?raw=1)");
  });

  it("pins third-party actions and starts every workflow with minimum permissions", async () => {
    const workflows = await Promise.all(
      ["release-train.yml", "promote-release.yml"].map(readWorkflow),
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
