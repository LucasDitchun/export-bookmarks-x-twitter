import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CHROME_WEB_STORE_ASSET_FILENAMES,
  CHROME_WEB_STORE_SCREENSHOT_SCENES,
  CHROME_WEB_STORE_LISTING_FIXTURE,
  evaluateChromeExpression,
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
      "screenshot-01-search-library.png",
      "screenshot-02-organize-folders-tags.png",
      "screenshot-03-note-folder-tags.png",
      "screenshot-04-capture-recent.png",
      "screenshot-05-export-private.png",
    ]);
    expect(
      CHROME_WEB_STORE_SCREENSHOT_SCENES.map(
        ({ filename, checkpoint, step, title }) => ({
          filename,
          checkpoint,
          step,
          title,
        }),
      ),
    ).toEqual([
      {
        filename: "screenshot-01-search-library.png",
        checkpoint: "library-search",
        step: "01 / FIND",
        title: "Find it again.",
      },
      {
        filename: "screenshot-02-organize-folders-tags.png",
        checkpoint: "library-organization",
        step: "02 / ORGANIZE",
        title: "Give it a place.",
      },
      {
        filename: "screenshot-03-note-folder-tags.png",
        checkpoint: "detail-organized-bookmark",
        step: "03 / REMEMBER",
        title: "Keep the context.",
      },
      {
        filename: "screenshot-04-capture-recent.png",
        checkpoint: "capture-recent",
        step: "04 / CAPTURE",
        title: "Only what’s new.",
      },
      {
        filename: "screenshot-05-export-private.png",
        checkpoint: "export-private",
        step: "05 / OWN",
        title: "Local means local.",
      },
    ]);

    for (const scene of CHROME_WEB_STORE_SCREENSHOT_SCENES) {
      expect(scene.title.trim().split(/\s+/).length).toBeLessThanOrEqual(4);
      expect(scene.accent).toMatch(/^#[\da-f]{6}$/i);
    }
  });

  it("seeds a credible, deterministic library without personal or remote content", () => {
    const { bookmarks, folders, tags } = CHROME_WEB_STORE_LISTING_FIXTURE;

    expect(bookmarks).toHaveLength(12);
    expect(folders.map(({ name, parentId }) => ({ name, parentId }))).toEqual([
      { name: "Reading", parentId: null },
      { name: "AI", parentId: "folder-reading" },
      { name: "Field Notes", parentId: null },
    ]);
    expect(tags.map(({ name }) => name)).toEqual([
      "Research",
      "Workflow",
      "Photography",
      "Design",
      "Open source",
    ]);
    expect(bookmarks.filter(({ status }) => status === "current")).toHaveLength(10);
    expect(bookmarks.filter(({ status }) => status === "archived")).toHaveLength(2);
    expect(bookmarks.filter(({ folderId }) => folderId === null)).toHaveLength(3);
    expect(
      bookmarks.filter(({ note }) => note.length > 0).length,
    ).toBeGreaterThanOrEqual(5);
    expect(
      bookmarks.filter(({ tagIds }) => tagIds.length > 0).length,
    ).toBeGreaterThanOrEqual(8);
    expect(
      bookmarks.every(({ url }) => url.startsWith("https://x.com/bookmarkx/")),
    ).toBe(true);
  });

  it("reads PNG dimensions from the IHDR header", () => {
    expect(readPngSize(pngStub(1280, 800))).toEqual({ width: 1280, height: 800 });
  });

  it("fails generation when a Chrome checkpoint expression throws", async () => {
    const devTools = {
      send: async () => ({
        result: { description: "Error: fixture restore failed" },
        exceptionDetails: { text: "Uncaught" },
      }),
    };

    await expect(evaluateChromeExpression(devTools, "broken()")).rejects.toThrow(
      "Chrome checkpoint evaluation failed: Error: fixture restore failed",
    );
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
