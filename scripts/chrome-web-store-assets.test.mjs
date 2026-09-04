import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CHROME_WEB_STORE_ASSET_FILENAMES,
  generateChromeWebStoreAssets,
  readPngSize,
  validateChromeWebStoreAssets,
  validateCuratedChromeWebStoreScreenshots,
} from "./chrome-web-store-assets.mjs";

const temporaryDirectories = [];

function pngStub(width, height, marker = "") {
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
  return Buffer.concat([
    signature,
    ihdrLength,
    ihdrType,
    ihdrData,
    fakeCrc,
    Buffer.from(marker),
    iend,
  ]);
}

async function temporaryAssetDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "bookmark-x-cws-assets-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeCuratedScreenshots(directory) {
  for (const [
    index,
    filename,
  ] of CHROME_WEB_STORE_ASSET_FILENAMES.screenshots.entries()) {
    await writeFile(join(directory, filename), pngStub(1280, 800, `curated-${index}`));
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Chrome Web Store asset contract", () => {
  it("pins the exact five curated screenshot filenames", () => {
    expect(CHROME_WEB_STORE_ASSET_FILENAMES.screenshots).toEqual([
      "screenshot-01-search-library.png",
      "screenshot-02-organize-folders-tags.png",
      "screenshot-03-note-folder-tags.png",
      "screenshot-04-capture-recent.png",
      "screenshot-05-export-private.png",
    ]);
  });

  it("reads PNG dimensions from the IHDR header", () => {
    expect(readPngSize(pngStub(1280, 800))).toEqual({ width: 1280, height: 800 });
  });

  it("rejects data that is not a PNG", () => {
    expect(() => readPngSize(Buffer.from("not a png"))).toThrow(
      "Expected a PNG file with a readable IHDR header.",
    );
  });

  it("accepts the complete asset set", async () => {
    const directory = await temporaryAssetDirectory();
    await writeCuratedScreenshots(directory);
    await writeFile(
      join(directory, CHROME_WEB_STORE_ASSET_FILENAMES.icon),
      pngStub(128, 128),
    );
    await writeFile(
      join(directory, CHROME_WEB_STORE_ASSET_FILENAMES.smallPromo),
      pngStub(440, 280),
    );
    await writeFile(
      join(directory, CHROME_WEB_STORE_ASSET_FILENAMES.marquee),
      pngStub(1400, 560),
    );

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

  it("rejects missing, extra, and badly sized curated screenshots", async () => {
    const missingDirectory = await temporaryAssetDirectory();
    await writeCuratedScreenshots(missingDirectory);
    await rm(join(missingDirectory, CHROME_WEB_STORE_ASSET_FILENAMES.screenshots[4]));
    await expect(
      validateCuratedChromeWebStoreScreenshots(missingDirectory),
    ).rejects.toThrow("must contain exactly these five curated screenshots");

    const extraDirectory = await temporaryAssetDirectory();
    await writeCuratedScreenshots(extraDirectory);
    await writeFile(
      join(extraDirectory, "screenshot-06-extra.png"),
      pngStub(1280, 800),
    );
    await expect(
      validateCuratedChromeWebStoreScreenshots(extraDirectory),
    ).rejects.toThrow("must contain exactly these five curated screenshots");

    const badlySizedDirectory = await temporaryAssetDirectory();
    await writeCuratedScreenshots(badlySizedDirectory);
    await writeFile(
      join(badlySizedDirectory, CHROME_WEB_STORE_ASSET_FILENAMES.screenshots[0]),
      pngStub(640, 400),
    );
    await expect(
      validateCuratedChromeWebStoreScreenshots(badlySizedDirectory),
    ).rejects.toThrow("must be 1280x800");
  });

  it("generates only the icon and promo tiles without changing curated screenshots", async () => {
    const directory = await temporaryAssetDirectory();
    await writeCuratedScreenshots(directory);
    const screenshotPaths = CHROME_WEB_STORE_ASSET_FILENAMES.screenshots.map(
      (filename) => join(directory, filename),
    );
    const before = await Promise.all(screenshotPaths.map((path) => readFile(path)));
    const iconSourcePath = join(directory, "source-icon.png");
    await writeFile(iconSourcePath, pngStub(128, 128, "source-icon"));
    const renderScene = vi.fn(async ({ outputPath, width, height }) => {
      await writeFile(outputPath, pngStub(width, height, "generated-promo"));
    });

    await generateChromeWebStoreAssets(directory, {
      chromeBinary: "/fake/chrome",
      iconSourcePath,
      renderScene,
    });

    const after = await Promise.all(screenshotPaths.map((path) => readFile(path)));
    expect(after).toEqual(before);
    expect(renderScene).toHaveBeenCalledTimes(2);
    expect(renderScene.mock.calls.map(([call]) => call.outputPath)).toEqual([
      join(directory, CHROME_WEB_STORE_ASSET_FILENAMES.smallPromo),
      join(directory, CHROME_WEB_STORE_ASSET_FILENAMES.marquee),
    ]);
  });

  it("fails if a generator dependency modifies a curated screenshot", async () => {
    const directory = await temporaryAssetDirectory();
    await writeCuratedScreenshots(directory);
    const iconSourcePath = join(directory, "source-icon.png");
    await writeFile(iconSourcePath, pngStub(128, 128));
    const firstScreenshot = join(
      directory,
      CHROME_WEB_STORE_ASSET_FILENAMES.screenshots[0],
    );
    let renderCount = 0;

    await expect(
      generateChromeWebStoreAssets(directory, {
        chromeBinary: "/fake/chrome",
        iconSourcePath,
        renderScene: async ({ outputPath, width, height }) => {
          await writeFile(outputPath, pngStub(width, height));
          renderCount += 1;
          if (renderCount === 2) {
            await writeFile(firstScreenshot, pngStub(1280, 800, "overwritten"));
          }
        },
      }),
    ).rejects.toThrow(
      "Asset generation must not modify curated screenshot screenshot-01-search-library.png.",
    );
  });

  it("refuses generation before writing anything when a curated screenshot is missing", async () => {
    const directory = await temporaryAssetDirectory();
    const iconSourcePath = join(directory, "source-icon.png");
    await writeFile(iconSourcePath, pngStub(128, 128));
    const renderScene = vi.fn();

    await expect(
      generateChromeWebStoreAssets(directory, {
        chromeBinary: "/fake/chrome",
        iconSourcePath,
        renderScene,
      }),
    ).rejects.toThrow("must contain exactly these five curated screenshots");
    expect(renderScene).not.toHaveBeenCalled();
  });
});
