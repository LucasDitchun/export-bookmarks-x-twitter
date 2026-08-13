import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { SUPPORTED_LOCALES } from "../domain/types";
import {
  BOOKMARK_DECORATOR_MESSAGE_KEYS,
  BOOKMARK_METADATA_MESSAGE_KEYS,
  BOOKMARK_MODAL_MESSAGE_KEYS,
  bookmarkMetadataMessagesFromCatalog,
} from "./bookmark-metadata-messages";

describe("bookmark metadata message contract", () => {
  it("combines every injected modal and decorator message without duplicates", () => {
    expect(BOOKMARK_METADATA_MESSAGE_KEYS).toEqual([
      ...new Set([...BOOKMARK_MODAL_MESSAGE_KEYS, ...BOOKMARK_DECORATOR_MESSAGE_KEYS]),
    ]);
    expect(BOOKMARK_METADATA_MESSAGE_KEYS).toContain("liveBookmarkArchived");
    expect(BOOKMARK_METADATA_MESSAGE_KEYS).not.toContain("bookmarkMetadataMapped");
    expect(BOOKMARK_METADATA_MESSAGE_KEYS).not.toContain("bookmarkNeedsCategory");
  });

  it.each(SUPPORTED_LOCALES)(
    "loads every required injected message from the %s catalog",
    (locale) => {
      const catalog = JSON.parse(
        readFileSync(
          resolve(process.cwd(), `public/_locales/${locale}/messages.json`),
          "utf8",
        ),
      ) as unknown;

      const messages = bookmarkMetadataMessagesFromCatalog(catalog);

      expect(Object.keys(messages)).toEqual(BOOKMARK_METADATA_MESSAGE_KEYS);
      expect(
        Object.values(messages).every((message) => message.trim().length > 0),
      ).toBe(true);
      expect(catalog).not.toHaveProperty("bookmarkMetadataMapped");
      expect(catalog).not.toHaveProperty("bookmarkPromptChooseFolder");
      expect(catalog).not.toHaveProperty("bookmarkPromptChooseTag");
    },
  );

  it("rejects an incomplete or malformed catalog instead of serving raw keys", () => {
    expect(() => bookmarkMetadataMessagesFromCatalog({})).toThrow(
      /bookmarkPromptTitle/,
    );
    const malformed: Record<string, unknown> = Object.fromEntries(
      BOOKMARK_METADATA_MESSAGE_KEYS.map((key) => [key, { message: key }]),
    );
    malformed.bookmarkMetadataLabel = { message: 42 };
    expect(() => bookmarkMetadataMessagesFromCatalog(malformed)).toThrow(
      /bookmarkMetadataLabel/,
    );
  });
});
