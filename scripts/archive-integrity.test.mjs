import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

async function insertBeforeCentralDirectory(archivePath, hiddenBytes) {
  const archive = await readFile(archivePath);
  const endOffset = archive.length - 22;
  const centralDirectoryOffset = archive.readUInt32LE(endOffset + 16);
  const mutated = Buffer.concat([
    archive.subarray(0, centralDirectoryOffset),
    hiddenBytes,
    archive.subarray(centralDirectoryOffset),
  ]);
  mutated.writeUInt32LE(
    centralDirectoryOffset + hiddenBytes.length,
    endOffset + hiddenBytes.length + 16,
  );
  await writeFile(archivePath, mutated);
}

function orphanStoredFile(path, contents) {
  const pathBytes = Buffer.from(path);
  const contentBytes = Buffer.from(contents);
  const localFile = Buffer.alloc(30 + pathBytes.length + contentBytes.length);
  localFile.writeUInt32LE(0x04034b50, 0);
  localFile.writeUInt16LE(20, 4);
  localFile.writeUInt32LE(contentBytes.length, 18);
  localFile.writeUInt32LE(contentBytes.length, 22);
  localFile.writeUInt16LE(pathBytes.length, 26);
  pathBytes.copy(localFile, 30);
  contentBytes.copy(localFile, 30 + pathBytes.length);
  return localFile;
}

async function appendZipComment(archivePath, comment) {
  const archive = await readFile(archivePath);
  const commentBytes = Buffer.from(comment);
  const endOffset = archive.length - 22;
  const mutated = Buffer.concat([archive, commentBytes]);
  mutated.writeUInt16LE(commentBytes.length, endOffset + 20);
  await writeFile(archivePath, mutated);
}

async function insertBeforeEndRecord(archivePath, hiddenBytes) {
  const archive = await readFile(archivePath);
  const endOffset = archive.length - 22;
  await writeFile(
    archivePath,
    Buffer.concat([
      archive.subarray(0, endOffset),
      hiddenBytes,
      archive.subarray(endOffset),
    ]),
  );
}

async function overlapSecondEntryWithFirstPayload(archivePath) {
  const archive = await readFile(archivePath);
  const endOffset = archive.length - 22;
  const centralDirectoryOffset = archive.readUInt32LE(endOffset + 16);
  const firstCentralPathLength = archive.readUInt16LE(centralDirectoryOffset + 28);
  const firstCentralExtraLength = archive.readUInt16LE(centralDirectoryOffset + 30);
  const firstCentralCommentLength = archive.readUInt16LE(centralDirectoryOffset + 32);
  const secondCentralOffset =
    centralDirectoryOffset +
    46 +
    firstCentralPathLength +
    firstCentralExtraLength +
    firstCentralCommentLength;
  const firstLocalOffset = archive.readUInt32LE(centralDirectoryOffset + 42);
  const firstLocalPathLength = archive.readUInt16LE(firstLocalOffset + 26);
  const firstLocalExtraLength = archive.readUInt16LE(firstLocalOffset + 28);
  const firstPayloadOffset =
    firstLocalOffset + 30 + firstLocalPathLength + firstLocalExtraLength;

  archive.writeUInt16LE(0, secondCentralOffset + 8);
  archive.writeUInt32LE(firstPayloadOffset, secondCentralOffset + 42);
  await writeFile(archivePath, archive);
}

async function injectLocalExtraField(archivePath, hiddenBytes) {
  const archive = await readFile(archivePath);
  const endOffset = archive.length - 22;
  const centralDirectoryOffset = archive.readUInt32LE(endOffset + 16);
  const localOffset = archive.readUInt32LE(centralDirectoryOffset + 42);
  const localPathLength = archive.readUInt16LE(localOffset + 26);
  const localExtraLength = archive.readUInt16LE(localOffset + 28);
  const insertionOffset = localOffset + 30 + localPathLength + localExtraLength;
  const mutated = Buffer.concat([
    archive.subarray(0, insertionOffset),
    hiddenBytes,
    archive.subarray(insertionOffset),
  ]);
  mutated.writeUInt16LE(localExtraLength + hiddenBytes.length, localOffset + 28);
  mutated.writeUInt32LE(
    centralDirectoryOffset + hiddenBytes.length,
    endOffset + hiddenBytes.length + 16,
  );
  await writeFile(archivePath, mutated);
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

  it("rejects an orphan local file hidden before the central directory", async () => {
    const archive = await createArchive([{ path: "manifest.json", content: "{}" }]);
    await insertBeforeCentralDirectory(
      archive,
      orphanStoredFile("hidden.txt", "unreviewed payload"),
    );

    await expect(archiveContentManifest(archive)).rejects.toThrow(
      "unreferenced bytes before the central directory",
    );
  });

  it("rejects trailing bytes disguised as a ZIP comment", async () => {
    const archive = await createArchive([{ path: "manifest.json", content: "{}" }]);
    await appendZipComment(archive, "unreviewed trailing payload");

    await expect(archiveContentManifest(archive)).rejects.toThrow(
      "ZIP comments are not allowed",
    );
  });

  it("rejects hidden bytes between the central directory and end record", async () => {
    const archive = await createArchive([{ path: "manifest.json", content: "{}" }]);
    await insertBeforeEndRecord(archive, Buffer.from("unreviewed central slack"));

    await expect(archiveContentManifest(archive)).rejects.toThrow(
      "unreferenced bytes after the central directory",
    );
  });

  it("rejects overlapping local file ranges", async () => {
    const archive = await createArchive(
      [
        { path: "a.txt", content: orphanStoredFile("b.txt", "B") },
        { path: "b.txt", content: "B" },
      ],
      { store: true },
    );
    await overlapSecondEntryWithFirstPayload(archive);

    await expect(archiveContentManifest(archive)).rejects.toThrow(
      "local file ranges overlap",
    );
  });

  it("rejects payload bytes hidden in a directory entry", async () => {
    const archive = await createArchive([
      { path: "manifest.json", content: "{}" },
      { path: "hidden/", content: "unreviewed directory payload" },
    ]);

    await expect(archiveContentManifest(archive)).rejects.toThrow(
      "directory entry must be empty",
    );
  });

  it("rejects payload hidden in a local ZIP extra field", async () => {
    const archive = await createArchive([{ path: "manifest.json", content: "{}" }]);
    await injectLocalExtraField(archive, Buffer.from("unreviewed local extra"));

    await expect(archiveContentManifest(archive)).rejects.toThrow(
      "local ZIP extra fields are not allowed",
    );
  });
});
