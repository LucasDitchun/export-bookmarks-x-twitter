import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CHROME_WEB_STORE_ASSET_FILENAMES,
  CHROME_WEB_STORE_SCREENSHOT_SCENES,
  CHROME_WEB_STORE_LISTING_FIXTURE,
  readPngSize,
  validateChromeWebStoreAssets,
} from "./chrome-web-store-assets.mjs";

const temporaryDirectories = [];

function pngStub(width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrLength = Buffer.from([0x00, 0x00, 0x00, 0x0d]);
  const ihdrType = Buffer.from("IHDR");
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  const fakeCrc = Buffer.from([0x00, 0x00, 0x00, 0x00]);
  const iend = Buffer.from([
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  return Buffer.concat([signature, ihdrLength, ihdrType, ihdrData, fakeCrc, iend]);
}

async function temporaryAssetDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "bookmark-x-cws-assets-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Chrome Web Store asset contract", () => {
  it("pins screenshot filenames to the exact UI states shown in the listing", () => {
    expect(CHROME_WEB_STORE_ASSET_FILENAMES.screenshots).toEqual([
      "screenshot-01-dashboard-overview.png",
      "screenshot-02-library-inbox.png",
      "screenshot-03-bookmark-detail-note-tags.png",
      "screenshot-04-library-organization.png",
      "screenshot-05-library-archived-search.png",
    ]);
    expect(
      CHROME_WEB_STORE_SCREENSHOT_SCENES.map(({ filename, checkpoint }) => ({
        filename,
        checkpoint,
      })),
    ).toEqual([
      {
        filename: "screenshot-01-dashboard-overview.png",
        checkpoint: "home-dashboard",
      },
      {
        filename: "screenshot-02-library-inbox.png",
        checkpoint: "library-inbox",
      },
      {
        filename: "screenshot-03-bookmark-detail-note-tags.png",
        checkpoint: "detail-organized-bookmark",
      },
      {
        filename: "screenshot-04-library-organization.png",
        checkpoint: "library-organization",
      },
      {
        filename: "screenshot-05-library-archived-search.png",
        checkpoint: "library-archived-search",
      },
    ]);
  });

  it("seeds a deterministic listing fixture with safe data across inbox, current, and archived views", () => {
    const { bookmarks, folders, tags } = CHROME_WEB_STORE_LISTING_FIXTURE;

    expect(bookmarks).toHaveLength(3);
    expect(folders.map(({ name, parentId }) => ({ name, parentId }))).toEqual([
      { name: "Reading", parentId: null },
      { name: "AI", parentId: "folder-reading" },
      { name: "Field Notes", parentId: null },
    ]);
    expect(tags.map(({ name }) => name)).toEqual([
      "Research",
      "Workflow",
      "Photography",
    ]);
    expect(
      bookmarks.map(({ id, status, folderId, tagIds, note }) => ({
        id,
        status,
        folderId,
        tagCount: tagIds.length,
        hasNote: note.length > 0,
      })),
    ).toEqual([
      {
        id: "111",
        status: "current",
        folderId: null,
        tagCount: 0,
        hasNote: false,
      },
      {
        id: "222",
        status: "current",
        folderId: "folder-ai",
        tagCount: 2,
        hasNote: true,
      },
      {
        id: "333",
        status: "archived",
        folderId: "folder-field-notes",
        tagCount: 1,
        hasNote: true,
      },
    ]);
  });

  it("reads PNG dimensions from the IHDR header", () => {
    expect(readPngSize(pngStub(1280, 800))).toEqual({ width: 1280, height: 800 });
  });

  it("accepts the generated asset set with five full-bleed screenshots", async () => {
    const directory = await temporaryAssetDirectory();
    const allFiles = [
      CHROME_WEB_STORE_ASSET_FILENAMES.icon,
      ...CHROME_WEB_STORE_ASSET_FILENAMES.screenshots,
      CHROME_WEB_STORE_ASSET_FILENAMES.smallPromo,
      CHROME_WEB_STORE_ASSET_FILENAMES.marquee,
    ];
    for (const file of allFiles) {
      const dimensions =
        file === CHROME_WEB_STORE_ASSET_FILENAMES.icon
          ? [128, 128]
          : file === CHROME_WEB_STORE_ASSET_FILENAMES.smallPromo
            ? [440, 280]
            : file === CHROME_WEB_STORE_ASSET_FILENAMES.marquee
              ? [1400, 560]
              : [1280, 800];
      await writeFile(join(directory, file), pngStub(...dimensions));
    }

    await expect(validateChromeWebStoreAssets(directory)).resolves.toEqual({
      icon: {
        filename: CHROME_WEB_STORE_ASSET_FILENAMES.icon,
        width: 128,
        height: 128,
      },
      screenshots: CHROME_WEB_STORE_ASSET_FILENAMES.screenshots.map((filename) => ({
        filename,
        width: 1280,
        height: 800,
      })),
      smallPromo: {
        filename: CHROME_WEB_STORE_ASSET_FILENAMES.smallPromo,
        width: 440,
        height: 280,
      },
      marquee: {
        filename: CHROME_WEB_STORE_ASSET_FILENAMES.marquee,
        width: 1400,
        height: 560,
      },
    });
  });

  it("rejects missing, oversized, and badly sized screenshot sets", async () => {
    const directory = await temporaryAssetDirectory();
    await writeFile(
      join(directory, CHROME_WEB_STORE_ASSET_FILENAMES.icon),
      pngStub(128, 128),
    );
    await writeFile(
      join(directory, CHROME_WEB_STORE_ASSET_FILENAMES.smallPromo),
      pngStub(440, 280),
    );
    for (const [
      index,
      filename,
    ] of CHROME_WEB_STORE_ASSET_FILENAMES.screenshots.entries()) {
      await writeFile(
        join(directory, filename),
        pngStub(index === 0 ? 640 : 1280, index === 0 ? 400 : 800),
      );
    }
    await writeFile(join(directory, "screenshot-06-extra.png"), pngStub(1280, 800));

    await expect(validateChromeWebStoreAssets(directory)).rejects.toThrow(
      "must contain between 1 and 5 screenshots with the expected filenames",
    );
  });
});
