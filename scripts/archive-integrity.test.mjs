import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pipeline } from "node:stream/promises";

import { ZipArchive } from "archiver";
import { afterEach, describe, expect, it } from "vitest";

import {
  archiveContentManifest,
  assertArchivesHaveEqualContent,
  parseArchiveComparisonArguments,
} from "./archive-integrity.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function createArchive(entries, options = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), "bookmark-x-archive-test-"));
  temporaryDirectories.push(directory);
  const archivePath = resolve(directory, "fixture.zip");
  const archive = new ZipArchive(
    options.store === true ? { store: true } : { zlib: { level: 9 } },
  );
  const output = createWriteStream(archivePath);
  const completion = pipeline(archive, output);

  for (const entry of entries) {
    archive.append(Buffer.from(entry.content), {
      date: entry.date,
      name: entry.path,
    });
  }
  await Promise.all([archive.finalize(), completion]);
  return archivePath;
}

describe("release ZIP content integrity", () => {
  it("accepts pnpm's argument separator", () => {
    expect(
      parseArchiveComparisonArguments(["compare", "--", "reviewed.zip", "rebuilt.zip"]),
    ).toEqual({ actualPath: "rebuilt.zip", expectedPath: "reviewed.zip" });
  });

  it("builds a stable path, sha256, and size manifest", async () => {
    const archive = await createArchive([
      { path: "manifest.json", content: "{}", date: new Date("2025-01-01Z") },
      { path: "assets/app.js", content: "hello", date: new Date("2025-01-01Z") },
    ]);

    await expect(archiveContentManifest(archive)).resolves.toEqual([
      {
        path: "assets/app.js",
        sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        size: 5,
      },
      {
        path: "manifest.json",
        sha256: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
        size: 2,
      },
    ]);
  });

  it("ignores entry order, timestamps, and compression", async () => {
    const expected = await createArchive([
      { path: "manifest.json", content: "{}", date: new Date("2025-01-01Z") },
      { path: "assets/app.js", content: "hello", date: new Date("2025-01-01Z") },
    ]);
    const rebuilt = await createArchive(
      [
        { path: "assets/app.js", content: "hello", date: new Date("2026-08-09Z") },
        { path: "manifest.json", content: "{}", date: new Date("2026-08-09Z") },
      ],
      { store: true },
    );

    await expect(
      assertArchivesHaveEqualContent(expected, rebuilt),
    ).resolves.toBeUndefined();
  });

  it("reports changed, missing, and unexpected files", async () => {
    const expected = await createArchive([
      { path: "manifest.json", content: "{}" },
      { path: "assets/app.js", content: "safe" },
    ]);
    const rebuilt = await createArchive([
      { path: "manifest.json", content: '{"changed":true}' },
      { path: "unexpected.js", content: "payload" },
    ]);

    await expect(assertArchivesHaveEqualContent(expected, rebuilt)).rejects.toThrow(
      /assets\/app\.js: missing.*manifest\.json: content differs.*unexpected\.js: unexpected/s,
    );
  });
});
