import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { parseArguments } from "./semantic-browser-gate.mjs";

test("requires an explicit real-run flag before the browser can download the model", () => {
  assert.deepEqual(parseArguments([]), {
    run: false,
    timeoutMs: 15 * 60 * 1000,
    keepProfile: false,
  });
  assert.deepEqual(
    parseArguments(["--run", "--timeout-ms", "120000", "--keep-profile"]),
    { run: true, timeoutMs: 120000, keepProfile: true },
  );
  assert.throws(() => parseArguments(["--timeout-ms", "999"]), /at least 10000/u);
  assert.throws(() => parseArguments(["--unknown"]), /Unknown argument/u);
});

test("keeps the browser model download out of default test and Chrome smoke commands", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageJson.scripts["semantic-browser:gate"],
    "pnpm build && node scripts/semantic-browser-gate.mjs --run",
  );
  assert.equal(
    packageJson.scripts["semantic-browser:gate:dry-run"],
    "node scripts/semantic-browser-gate.mjs",
  );
  assert.equal(
    packageJson.scripts["semantic-browser:gate:test"],
    "node --test scripts/semantic-browser-gate.node-test.mjs",
  );
  assert.doesNotMatch(packageJson.scripts.test, /semantic-browser/u);
  assert.doesNotMatch(packageJson.scripts["smoke:chrome"], /semantic-browser/u);
});

test("runs the explicit install scenario with a DevTools user gesture", async () => {
  const source = await readFile(
    new URL("./semantic-browser-gate.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /userGesture:\s*userGesture/u);
  assert.match(
    source,
    /installScenario\(options\.timeoutMs\),\s*"consent\/install\/index",\s*true/u,
  );
});
