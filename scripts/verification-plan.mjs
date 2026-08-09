import { spawn } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

function pnpm(label, ...arguments_) {
  return { label, commands: [{ command: "pnpm", arguments: arguments_ }] };
}

export const VERIFICATION_PROFILES = Object.freeze({
  local: Object.freeze([
    pnpm("format", "format:check"),
    pnpm("lint", "lint"),
    pnpm("typecheck", "typecheck"),
    pnpm("tests", "test"),
    pnpm("build", "build"),
  ]),
  staging: Object.freeze([
    pnpm("audit", "audit:high"),
    pnpm("format", "format:check"),
    pnpm("lint", "lint"),
    pnpm("typecheck", "typecheck"),
    {
      label: "release-policy",
      commands: [
        {
          command: "node",
          arguments: ["--test", ".github/scripts/release-train.test.mjs"],
        },
      ],
    },
    {
      label: "semantic-contracts",
      commands: [
        { command: "pnpm", arguments: ["semantic-model:gate:test"] },
        { command: "pnpm", arguments: ["semantic-model:gate:dry-run"] },
        { command: "pnpm", arguments: ["semantic-browser:gate:test"] },
        { command: "pnpm", arguments: ["semantic-browser:gate:dry-run"] },
      ],
    },
    pnpm("coverage", "test:coverage"),
    pnpm("build", "build"),
    pnpm("semantic-model", "semantic-model:gate"),
    pnpm("package", "package"),
    pnpm("chrome-smoke", "smoke:chrome"),
  ]),
});

function runCommand(command, arguments_) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, arguments_, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          `${command} ${arguments_.join(" ")} failed${signal ? ` with ${signal}` : ` with exit code ${String(code)}`}.`,
        ),
      );
    });
  });
}

export async function runVerificationProfile(profileName) {
  const profile = VERIFICATION_PROFILES[profileName];
  if (!profile) {
    throw new Error(`Unknown verification profile: ${String(profileName)}.`);
  }

  const profileStartedAt = Date.now();
  for (const step of profile) {
    const startedAt = Date.now();
    console.log(`\n▶ ${step.label}`);
    for (const command of step.commands) {
      await runCommand(command.command, command.arguments);
    }
    console.log(`✓ ${step.label} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
  }
  console.log(
    `\nVerification profile ${profileName} passed in ${((Date.now() - profileStartedAt) / 1000).toFixed(1)}s.`,
  );
}

async function main() {
  const [profileName, ...unexpected] = process.argv.slice(2);
  if (!profileName || unexpected.length > 0) {
    throw new Error("Usage: node scripts/verification-plan.mjs <local|staging>");
  }
  await runVerificationProfile(profileName);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
