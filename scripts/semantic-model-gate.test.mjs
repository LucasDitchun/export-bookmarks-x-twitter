import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  CRITICAL_ASSETS,
  MODEL_GATE_CASES,
  MODEL_ID,
  MODEL_REVISION,
  assertEmbedding,
  assertExpectedRanking,
  buildAssetUrl,
  parseArguments,
  runGate,
  verifyFile,
} from "./semantic-model-gate.mjs";

test("pins the production model revision and audited Hugging Face LFS objects", async () => {
  assert.equal(MODEL_ID, "Xenova/multilingual-e5-small");
  assert.equal(MODEL_REVISION, "761b726dd34fb83930e26aab4e9ac3899aa1fa78");
  const productionModel = await readFile(
    new URL("../src/semantic/transformers-embedding-model.ts", import.meta.url),
    "utf8",
  );
  assert.match(productionModel, new RegExp(`MODEL_ID = "${MODEL_ID}"`, "u"));
  assert.match(
    productionModel,
    new RegExp(`MODEL_REVISION = "${MODEL_REVISION}"`, "u"),
  );
  assert.deepEqual(CRITICAL_ASSETS, [
    {
      path: "onnx/model_quantized.onnx",
      bytes: 118_308_185,
      sha256: "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193",
    },
    {
      path: "tokenizer.json",
      bytes: 17_082_730,
      sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39",
    },
  ]);
  assert.equal(
    buildAssetUrl(CRITICAL_ASSETS[0]),
    "https://huggingface.co/Xenova/multilingual-e5-small/resolve/761b726dd34fb83930e26aab4e9ac3899aa1fa78/onnx/model_quantized.onnx",
  );
});

test("covers deterministic relevant-query cases for every shipped language", () => {
  assert.deepEqual(
    MODEL_GATE_CASES.map(({ language }) => language),
    ["de", "en", "es", "fr", "it", "ja", "pt-BR", "zh-CN"],
  );
  assert.equal(new Set(MODEL_GATE_CASES.map(({ expectedId }) => expectedId)).size, 8);
  for (const testCase of MODEL_GATE_CASES) {
    assert.match(testCase.query, /^query: /u);
    assert.match(testCase.passage, /^passage: /u);
  }
});

test("verifies cached asset size and SHA-256", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bookmark-x-model-gate-"));
  const path = join(directory, "fixture.bin");
  await writeFile(path, "verified fixture", "utf8");
  const asset = {
    path: "fixture.bin",
    bytes: 16,
    sha256: "f9adb7d924ed98c558040c910600d7363d749e7d20e8d355626edd53b4fb929f",
  };

  await assert.doesNotReject(verifyFile(path, asset));
  await writeFile(path, "tampered fixture", "utf8");
  await assert.rejects(verifyFile(path, asset), /size mismatch|SHA-256 mismatch/u);
  await rm(directory, { recursive: true });
});

test("rejects malformed embeddings and ranking regressions", () => {
  const valid = new Float32Array(384).fill(1 / Math.sqrt(384));
  assert.doesNotThrow(() => assertEmbedding(valid, "valid"));

  assert.throws(() => assertEmbedding(new Float32Array(383), "short"), /384/u);
  const nonFinite = valid.slice();
  nonFinite[12] = Number.NaN;
  assert.throws(() => assertEmbedding(nonFinite, "nan"), /finite/u);
  assert.throws(
    () => assertEmbedding(new Float32Array(384), "zero"),
    /unit-normalized/u,
  );
  assert.throws(
    () => assertExpectedRanking("de", "wrong", "expected", 0.7, 0.6),
    /expected.*rank first/u,
  );
});

test("dry-run validates configuration without network or inference", async () => {
  assert.deepEqual(parseArguments(["--dry-run", "--cache-dir", "/tmp/model-cache"]), {
    cacheDir: "/tmp/model-cache",
    dryRun: true,
  });

  const calls = [];
  const result = await runGate(
    { cacheDir: "/tmp/model-cache", dryRun: true },
    {
      downloadAsset: async () => calls.push("download"),
      runInference: async () => calls.push("inference"),
      log: () => {},
    },
  );
  assert.deepEqual(calls, []);
  assert.deepEqual(result, { assets: 2, cases: 8, dryRun: true });
});

test("release candidate workflow invokes the real gate, while normal CI does not", async () => {
  const [releaseWorkflow, ciWorkflow, packageJson] = await Promise.all([
    readFile(
      new URL("../.github/workflows/release-train.yml", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  ]);

  assert.match(releaseWorkflow, /^\s*run: pnpm semantic-model:gate\s*$/mu);
  assert.doesNotMatch(releaseWorkflow, /semantic-model:gate --dry-run/u);
  assert.doesNotMatch(ciWorkflow, /^\s*(?:run:\s*)?pnpm semantic-model:gate\s*$/mu);
  assert.equal(
    packageJson.scripts["semantic-model:gate"],
    "node scripts/semantic-model-gate.mjs",
  );
  assert.equal(
    packageJson.scripts["semantic-model:gate:dry-run"],
    "node scripts/semantic-model-gate.mjs --dry-run",
  );
});
