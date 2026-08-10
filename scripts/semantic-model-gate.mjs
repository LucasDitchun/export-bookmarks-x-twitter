#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const MODEL_ID = "Xenova/multilingual-e5-small";
export const MODEL_REVISION = "761b726dd34fb83930e26aab4e9ac3899aa1fa78";
const MODEL_DTYPE = "q8";
const EMBEDDING_DIMENSIONS = 384;
const UNIT_NORM_TOLERANCE = 0.02;
const MINIMUM_SCORE_MARGIN = 0.01;

export const CRITICAL_ASSETS = Object.freeze([
  Object.freeze({
    path: "onnx/model_quantized.onnx",
    bytes: 118_308_185,
    sha256: "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193",
  }),
  Object.freeze({
    path: "tokenizer.json",
    bytes: 17_082_730,
    sha256: "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39",
  }),
]);

const SUPPORT_ASSETS = Object.freeze([
  Object.freeze({
    path: "config.json",
    bytes: 658,
    sha256: "cb99455288675345e1a4f411438d5d0adbba5fbd3a67ea4fb03c015433b996c1",
  }),
  Object.freeze({
    path: "tokenizer_config.json",
    bytes: 443,
    sha256: "a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b",
  }),
]);

const DOWNLOAD_ASSETS = Object.freeze([...SUPPORT_ASSETS, ...CRITICAL_ASSETS]);

export const MODEL_GATE_CASES = Object.freeze([
  Object.freeze({
    language: "de",
    expectedId: "bicycle-repair",
    query: "query: Wie repariere ich einen platten Fahrradreifen?",
    passage:
      "passage: Anleitung zum Flicken eines Fahrradschlauchs und zum Aufpumpen des Reifens.",
  }),
  Object.freeze({
    language: "en",
    expectedId: "night-photography",
    query: "query: How can I photograph the Milky Way at night?",
    passage:
      "passage: A night photography guide to camera exposure, tripod setup, and focusing on the Milky Way.",
  }),
  Object.freeze({
    language: "es",
    expectedId: "puppy-training",
    query: "query: ¿Cómo enseño a un cachorro a sentarse?",
    passage:
      "passage: Consejos de adiestramiento canino con premios para enseñar a un cachorro la orden de sentarse.",
  }),
  Object.freeze({
    language: "fr",
    expectedId: "tomato-gardening",
    query: "query: Comment cultiver des tomates sur un balcon ?",
    passage:
      "passage: Guide de jardinage en pot pour planter, arroser et tuteurer des tomates sur un balcon.",
  }),
  Object.freeze({
    language: "it",
    expectedId: "mushroom-risotto",
    query: "query: Come si prepara un risotto ai funghi?",
    passage:
      "passage: Ricetta del risotto ai funghi con brodo caldo, tostatura del riso e mantecatura finale.",
  }),
  Object.freeze({
    language: "ja",
    expectedId: "earthquake-kit",
    query: "query: 地震に備えて何を用意すればよいですか？",
    passage:
      "passage: 地震への防災対策として、水、非常食、懐中電灯、救急用品を非常袋に準備する方法。",
  }),
  Object.freeze({
    language: "pt-BR",
    expectedId: "income-tax",
    query: "query: Como organizar os documentos do imposto de renda?",
    passage:
      "passage: Orientações para reunir informes de rendimentos, recibos e comprovantes antes da declaração do imposto de renda.",
  }),
  Object.freeze({
    language: "zh-CN",
    expectedId: "malware-protection",
    query: "query: 如何保护电脑免受恶意软件攻击？",
    passage:
      "passage: 通过及时更新系统、使用防病毒软件和识别钓鱼邮件来防止电脑感染恶意软件。",
  }),
]);

function cachePath(cacheDir, asset) {
  return join(cacheDir, MODEL_ID, MODEL_REVISION, asset.path);
}

export function buildAssetUrl(asset) {
  return `https://huggingface.co/${MODEL_ID}/resolve/${MODEL_REVISION}/${asset.path}`;
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifyFile(path, asset) {
  const metadata = await stat(path);
  if (metadata.size !== asset.bytes) {
    throw new Error(
      `${asset.path} size mismatch: expected ${asset.bytes}, received ${metadata.size}.`,
    );
  }
  const digest = await sha256(path);
  if (digest !== asset.sha256) {
    throw new Error(
      `${asset.path} SHA-256 mismatch: expected ${asset.sha256}, received ${digest}.`,
    );
  }
}

async function downloadAsset(asset, cacheDir, log = console.log) {
  const destination = cachePath(cacheDir, asset);
  try {
    await verifyFile(destination, asset);
    log(`asset cache hit: ${asset.path}`);
    return destination;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      log(`asset cache invalid, replacing: ${asset.path}`);
    }
  }

  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp.${process.pid}`;
  await rm(temporary, { force: true });
  const response = await fetch(buildAssetUrl(asset), {
    method: "GET",
    redirect: "follow",
    headers: { "user-agent": "bookmark-x-semantic-model-gate/1" },
  });
  if (!response.ok || response.body === null) {
    throw new Error(`Could not download ${asset.path}: HTTP ${response.status}.`);
  }

  const file = await open(temporary, "wx");
  try {
    for await (const chunk of response.body) await file.write(chunk);
  } catch (error) {
    await file.close();
    await rm(temporary, { force: true });
    throw error;
  }
  await file.close();

  try {
    await verifyFile(temporary, asset);
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  log(`asset downloaded and verified: ${asset.path}`);
  return destination;
}

function dot(left, right) {
  let score = 0;
  for (let index = 0; index < left.length; index += 1) {
    score += left[index] * right[index];
  }
  return score;
}

export function assertEmbedding(vector, label) {
  if (!(vector instanceof Float32Array) || vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `${label} must be a ${EMBEDDING_DIMENSIONS}-dimensional embedding.`,
    );
  }
  if (!vector.every(Number.isFinite)) {
    throw new Error(`${label} embedding values must all be finite.`);
  }
  const norm = Math.sqrt(dot(vector, vector));
  if (Math.abs(norm - 1) > UNIT_NORM_TOLERANCE) {
    throw new Error(`${label} must be unit-normalized; received norm ${norm}.`);
  }
}

export function assertExpectedRanking(
  language,
  firstId,
  expectedId,
  firstScore,
  runnerUpScore,
) {
  if (firstId !== expectedId) {
    throw new Error(
      `${language}: expected ${expectedId} to rank first, received ${firstId}.`,
    );
  }
  const margin = firstScore - runnerUpScore;
  if (!Number.isFinite(margin) || margin < MINIMUM_SCORE_MARGIN) {
    throw new Error(
      `${language}: expected a score margin of at least ${MINIMUM_SCORE_MARGIN}, received ${margin}.`,
    );
  }
}

function toVectors(tensor) {
  return tensor.tolist().map((values) => new Float32Array(values));
}

async function runInference(cacheDir, log = console.log) {
  const transformers = await import("@huggingface/transformers");
  const verifiedModelPath = join(cacheDir, MODEL_ID, MODEL_REVISION);
  transformers.env.allowLocalModels = true;
  transformers.env.allowRemoteModels = false;
  transformers.env.useBrowserCache = false;
  transformers.env.useCustomCache = false;
  transformers.env.useFSCache = false;
  transformers.env.fetch = async () => {
    throw new Error("Network access is forbidden after the pinned assets are cached.");
  };

  const startedAt = performance.now();
  const extractor = await transformers.pipeline(
    "feature-extraction",
    verifiedModelPath,
    {
      revision: MODEL_REVISION,
      dtype: MODEL_DTYPE,
      // Transformers.js selects ONNX Runtime CPU in Node; production uses the
      // browser's WASM fallback with the same q8 graph and preprocessing.
      device: "cpu",
      cache_dir: cacheDir,
      local_files_only: true,
    },
  );
  const loadedAt = performance.now();

  try {
    const passages = toVectors(
      await extractor(
        MODEL_GATE_CASES.map(({ passage }) => passage),
        { pooling: "mean", normalize: true },
      ),
    );
    const queries = toVectors(
      await extractor(
        MODEL_GATE_CASES.map(({ query }) => query),
        { pooling: "mean", normalize: true },
      ),
    );
    const inferredAt = performance.now();

    passages.forEach((vector, index) =>
      assertEmbedding(vector, `passage ${MODEL_GATE_CASES[index].expectedId}`),
    );
    queries.forEach((vector, index) =>
      assertEmbedding(vector, `query ${MODEL_GATE_CASES[index].language}`),
    );

    for (const [index, testCase] of MODEL_GATE_CASES.entries()) {
      const ranking = passages
        .map((passage, passageIndex) => ({
          id: MODEL_GATE_CASES[passageIndex].expectedId,
          score: dot(queries[index], passage),
        }))
        .sort(
          (left, right) => right.score - left.score || left.id.localeCompare(right.id),
        );
      assertExpectedRanking(
        testCase.language,
        ranking[0].id,
        testCase.expectedId,
        ranking[0].score,
        ranking[1].score,
      );
      log(
        `${testCase.language}: ${ranking[0].id} ranked first ` +
          `(score ${ranking[0].score.toFixed(4)}, margin ${(ranking[0].score - ranking[1].score).toFixed(4)})`,
      );
    }

    return {
      loadMilliseconds: Math.round(loadedAt - startedAt),
      inferenceMilliseconds: Math.round(inferredAt - loadedAt),
    };
  } finally {
    await extractor.dispose();
  }
}

export function parseArguments(args) {
  let cacheDir = resolve(tmpdir(), "bookmark-x-semantic-model-gate");
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dry-run") {
      dryRun = true;
    } else if (argument === "--cache-dir") {
      const value = args[index + 1];
      if (!value) throw new Error("--cache-dir requires a path.");
      cacheDir = resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return { cacheDir, dryRun };
}

export async function runGate(options, dependencies = {}) {
  const log = dependencies.log ?? console.log;
  if (options.dryRun) {
    log(
      `dry-run: ${MODEL_ID}@${MODEL_REVISION}, ${CRITICAL_ASSETS.length} critical assets, ${MODEL_GATE_CASES.length} languages; no network or inference`,
    );
    return {
      assets: CRITICAL_ASSETS.length,
      cases: MODEL_GATE_CASES.length,
      dryRun: true,
    };
  }

  const fetchAsset = dependencies.downloadAsset ?? downloadAsset;
  const infer = dependencies.runInference ?? runInference;
  const downloadStartedAt = performance.now();
  for (const asset of DOWNLOAD_ASSETS) await fetchAsset(asset, options.cacheDir, log);
  const downloadMilliseconds = Math.round(performance.now() - downloadStartedAt);
  const timing = await infer(options.cacheDir, log);
  log(
    `semantic model gate passed: download/cache ${downloadMilliseconds} ms, ` +
      `load ${timing.loadMilliseconds} ms, inference ${timing.inferenceMilliseconds} ms`,
  );
  return {
    assets: CRITICAL_ASSETS.length,
    cases: MODEL_GATE_CASES.length,
    dryRun: false,
    downloadMilliseconds,
    ...timing,
  };
}

async function main() {
  await runGate(parseArguments(process.argv.slice(2)));
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
