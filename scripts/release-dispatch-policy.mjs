import process from "node:process";
import { pathToFileURL } from "node:url";

const PREPARED_RELEASE_REF =
  /^automation\/prepare-v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/u;

export function assertReleaseDispatchIdentity({ actualSha, expectedSha, refName }) {
  if (!PREPARED_RELEASE_REF.test(refName)) {
    throw new Error("Release CI may only be dispatched for a prepared release branch.");
  }
  if (!FULL_COMMIT_SHA.test(expectedSha)) {
    throw new Error("Expected release SHA must be a full lowercase commit SHA.");
  }
  if (actualSha !== expectedSha) {
    throw new Error(
      `Dispatched release SHA does not match: expected ${expectedSha}, checked out ${actualSha}.`,
    );
  }
}

function readArguments(arguments_) {
  const normalizedArguments = arguments_.filter((argument) => argument !== "--");
  const [command, ...options] = normalizedArguments;
  if (command !== "validate") {
    throw new Error(
      "Usage: node scripts/release-dispatch-policy.mjs validate --ref-name <ref> --expected-sha <sha> --actual-sha <sha>",
    );
  }

  const values = {};
  for (let index = 0; index < options.length; index += 2) {
    const name = options[index];
    const value = options[index + 1];
    if (!value || !["--actual-sha", "--expected-sha", "--ref-name"].includes(name)) {
      throw new Error(`Invalid release dispatch argument: ${String(name)}.`);
    }
    values[name] = value;
  }
  return {
    actualSha: values["--actual-sha"],
    expectedSha: values["--expected-sha"],
    refName: values["--ref-name"],
  };
}

function main() {
  const identity = readArguments(process.argv.slice(2));
  assertReleaseDispatchIdentity(identity);
  console.log(`Release CI is bound to ${identity.refName}@${identity.actualSha}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
