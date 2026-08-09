import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { validateContentScriptBundle } from "./content-script-bundle-policy.mjs";

const bundlePath = resolve(import.meta.dirname, "..", "dist", "content-script.js");

try {
  validateContentScriptBundle(await readFile(bundlePath, "utf8"));
  console.log("Content script bundle policy passed: self-contained classic IIFE.");
} catch (error) {
  console.error(`Content script bundle policy failed: ${error.message}`);
  process.exitCode = 1;
}
