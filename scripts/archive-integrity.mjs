import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { inflateRawSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const MAXIMUM_COMMENT_LENGTH = 0xffff;
const MAXIMUM_ENTRY_SIZE = 256 * 1024 * 1024;
const MAXIMUM_ARCHIVE_SIZE = 512 * 1024 * 1024;

function comparePaths(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function fail(message) {
  throw new Error(`Archive integrity check failed: ${message}`);
}

function findEndOfCentralDirectory(archive) {
  const minimumOffset = Math.max(0, archive.length - (22 + MAXIMUM_COMMENT_LENGTH));

  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      continue;
    }

    const commentLength = archive.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === archive.length) {
      return offset;
    }
  }

  fail("end-of-central-directory record is missing or malformed.");
}

function decodePath(pathBytes) {
  let path;
  try {
    path = new TextDecoder("utf-8", { fatal: true }).decode(pathBytes);
  } catch {
    fail("an entry path is not valid UTF-8.");
  }

  const segments = path.split("/");
  if (
    path.length === 0 ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/u.test(path) ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    fail(`unsafe entry path: ${JSON.stringify(path)}.`);
  }
  return path;
}

function readDataDescriptorEnd(archive, dataEnd, centralDirectoryOffset, expected) {
  const hasSignature =
    dataEnd + 4 <= centralDirectoryOffset &&
    archive.readUInt32LE(dataEnd) === DATA_DESCRIPTOR_SIGNATURE;
  const descriptorOffset = dataEnd + (hasSignature ? 4 : 0);
  const descriptorEnd = descriptorOffset + 12;
  if (descriptorEnd > centralDirectoryOffset) {
    fail(`data descriptor points outside the local file region for ${expected.path}.`);
  }
  if (
    archive.readUInt32LE(descriptorOffset) !== expected.crc32 ||
    archive.readUInt32LE(descriptorOffset + 4) !== expected.compressedSize ||
    archive.readUInt32LE(descriptorOffset + 8) !== expected.uncompressedSize
  ) {
    fail(`data descriptor differs from the central directory for ${expected.path}.`);
  }
  return descriptorEnd;
}

function assertLocalFileRangesCoverArchive(ranges, centralDirectoryOffset) {
  const sortedRanges = [...ranges].sort(
    (left, right) => left.start - right.start || comparePaths(left.path, right.path),
  );
  let coveredUntil = 0;

  for (const range of sortedRanges) {
    if (range.start < coveredUntil) {
      fail(`local file ranges overlap at ${range.path}.`);
    }
    if (range.start > coveredUntil) {
      fail(
        `unreferenced bytes before the central directory at offset ${coveredUntil}.`,
      );
    }
    coveredUntil = range.end;
  }

  if (coveredUntil !== centralDirectoryOffset) {
    fail(`unreferenced bytes before the central directory at offset ${coveredUntil}.`);
  }
}

function readArchiveEntries(archive) {
  if (archive.length > MAXIMUM_ARCHIVE_SIZE) {
    fail("ZIP exceeds the maximum supported archive size.");
  }

  const endOffset = findEndOfCentralDirectory(archive);
  if (archive.readUInt16LE(endOffset + 20) !== 0) {
    fail("ZIP comments are not allowed.");
  }
  const diskNumber = archive.readUInt16LE(endOffset + 4);
  const centralDirectoryDisk = archive.readUInt16LE(endOffset + 6);
  const entriesOnDisk = archive.readUInt16LE(endOffset + 8);
  const entryCount = archive.readUInt16LE(endOffset + 10);
  const centralDirectorySize = archive.readUInt32LE(endOffset + 12);
  const centralDirectoryOffset = archive.readUInt32LE(endOffset + 16);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
    fail("multi-disk ZIP archives are not supported.");
  }
  if (
    entryCount === 0xffff ||
    centralDirectorySize === 0xffffffff ||
    centralDirectoryOffset === 0xffffffff
  ) {
    fail("ZIP64 archives are not supported.");
  }
  if (
    centralDirectoryOffset + centralDirectorySize > endOffset ||
    centralDirectoryOffset > archive.length
  ) {
    fail("central directory points outside the archive.");
  }
  if (centralDirectoryOffset + centralDirectorySize < endOffset) {
    fail("unreferenced bytes after the central directory.");
  }

  const entries = [];
  const localFileRanges = [];
  const seenPaths = new Set();
  let offset = centralDirectoryOffset;
  let totalUncompressedSize = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > archive.length ||
      archive.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE
    ) {
      fail("central directory entry is missing or malformed.");
    }

    const flags = archive.readUInt16LE(offset + 8);
    const compressionMethod = archive.readUInt16LE(offset + 10);
    const crc32 = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const pathLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const diskStart = archive.readUInt16LE(offset + 34);
    const localHeaderOffset = archive.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + pathLength + extraLength + commentLength;

    if (nextOffset > archive.length) {
      fail("central directory entry extends outside the archive.");
    }
    if (extraLength !== 0 || commentLength !== 0) {
      fail("central ZIP extra fields and comments are not allowed.");
    }
    if ((flags & 0x1) !== 0) {
      fail("encrypted ZIP entries are not supported.");
    }
    if (diskStart !== 0) {
      fail("multi-disk ZIP entries are not supported.");
    }
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      fail("ZIP64 entries are not supported.");
    }
    if (uncompressedSize > MAXIMUM_ENTRY_SIZE) {
      fail("an entry exceeds the maximum supported size.");
    }

    const path = decodePath(archive.subarray(offset + 46, offset + 46 + pathLength));
    if (seenPaths.has(path)) {
      fail(`duplicate entry path: ${path}.`);
    }
    if (path.endsWith("/") && (compressedSize !== 0 || uncompressedSize !== 0)) {
      fail(`directory entry must be empty: ${path}.`);
    }
    seenPaths.add(path);
    offset = nextOffset;

    if (
      localHeaderOffset + 30 > archive.length ||
      localHeaderOffset >= centralDirectoryOffset ||
      archive.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_SIGNATURE
    ) {
      fail(`local header is missing for ${path}.`);
    }
    const localPathLength = archive.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28);
    if (localExtraLength !== 0) {
      fail(`local ZIP extra fields are not allowed: ${path}.`);
    }
    const localFlags = archive.readUInt16LE(localHeaderOffset + 6);
    const localCompressionMethod = archive.readUInt16LE(localHeaderOffset + 8);
    if (localFlags !== flags || localCompressionMethod !== compressionMethod) {
      fail(`local header flags or compression differ for ${path}.`);
    }
    const dataOffset = localHeaderOffset + 30 + localPathLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;
    if (dataEnd > centralDirectoryOffset) {
      fail(`compressed data points outside the archive for ${path}.`);
    }
    const localPath = decodePath(
      archive.subarray(
        localHeaderOffset + 30,
        localHeaderOffset + 30 + localPathLength,
      ),
    );
    if (localPath !== path) {
      fail(`local and central paths differ for ${path}.`);
    }

    const localFileEnd =
      (flags & 0x8) === 0
        ? dataEnd
        : readDataDescriptorEnd(archive, dataEnd, centralDirectoryOffset, {
            compressedSize,
            crc32,
            path,
            uncompressedSize,
          });
    localFileRanges.push({ end: localFileEnd, path, start: localHeaderOffset });

    const compressed = archive.subarray(dataOffset, dataEnd);
    let contents;
    if (compressionMethod === 0) {
      contents = compressed;
    } else if (compressionMethod === 8) {
      try {
        contents = inflateRawSync(compressed, {
          maxOutputLength: MAXIMUM_ENTRY_SIZE,
        });
      } catch {
        fail(`deflate data is invalid for ${path}.`);
      }
    } else {
      fail(`unsupported compression method ${compressionMethod} for ${path}.`);
    }
    if (contents.length !== uncompressedSize) {
      fail(`uncompressed size differs for ${path}.`);
    }

    totalUncompressedSize += contents.length;
    if (totalUncompressedSize > MAXIMUM_ARCHIVE_SIZE) {
      fail("uncompressed ZIP contents exceed the maximum supported size.");
    }
    if (!path.endsWith("/")) {
      entries.push({
        path,
        sha256: createHash("sha256").update(contents).digest("hex"),
        size: contents.length,
      });
    }
  }

  if (offset !== centralDirectoryOffset + centralDirectorySize) {
    fail("central directory size does not match its entries.");
  }
  assertLocalFileRangesCoverArchive(localFileRanges, centralDirectoryOffset);

  return entries.sort((left, right) => comparePaths(left.path, right.path));
}

export async function archiveContentManifest(archivePath) {
  const archiveFile = await open(archivePath, "r");
  try {
    const { size } = await archiveFile.stat();
    if (size > MAXIMUM_ARCHIVE_SIZE) {
      fail("ZIP exceeds the maximum supported archive size.");
    }
    return readArchiveEntries(await archiveFile.readFile());
  } finally {
    await archiveFile.close();
  }
}

export async function assertArchivesHaveEqualContent(expectedPath, actualPath) {
  const [expectedEntries, actualEntries] = await Promise.all([
    archiveContentManifest(expectedPath),
    archiveContentManifest(actualPath),
  ]);
  const expected = new Map(expectedEntries.map((entry) => [entry.path, entry]));
  const actual = new Map(actualEntries.map((entry) => [entry.path, entry]));
  const paths = [...new Set([...expected.keys(), ...actual.keys()])].sort(comparePaths);
  const differences = [];

  for (const path of paths) {
    const expectedEntry = expected.get(path);
    const actualEntry = actual.get(path);
    if (!actualEntry) {
      differences.push(`${path}: missing`);
    } else if (!expectedEntry) {
      differences.push(`${path}: unexpected`);
    } else if (
      expectedEntry.size !== actualEntry.size ||
      expectedEntry.sha256 !== actualEntry.sha256
    ) {
      differences.push(`${path}: content differs`);
    }
  }

  if (differences.length > 0) {
    fail(`ZIP contents differ:\n${differences.join("\n")}`);
  }
}

export function parseArchiveComparisonArguments(arguments_) {
  const normalizedArguments = [...arguments_];
  if (normalizedArguments[1] === "--") {
    normalizedArguments.splice(1, 1);
  }
  const [command, expectedPath, actualPath, ...extraArguments] = normalizedArguments;
  if (
    command !== "compare" ||
    !expectedPath ||
    !actualPath ||
    extraArguments.length > 0
  ) {
    throw new Error(
      "Usage: node scripts/archive-integrity.mjs compare <reviewed.zip> <rebuilt.zip>",
    );
  }
  return { actualPath, expectedPath };
}

async function main() {
  const { actualPath, expectedPath } = parseArchiveComparisonArguments(
    process.argv.slice(2),
  );

  await assertArchivesHaveEqualContent(resolve(expectedPath), resolve(actualPath));
  console.log("Reviewed and rebuilt ZIPs contain the same files and bytes.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
