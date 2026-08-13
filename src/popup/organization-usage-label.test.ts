import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { organizationUsageLabel } from "./organization-usage-label";

const translate = (key: string, substitutions?: string | string[]): string => {
  const values = typeof substitutions === "string" ? [substitutions] : substitutions;
  return `${key}:${values?.join("|") ?? ""}`;
};

describe("organization usage label", () => {
  it("uses the singular label only for one bookmark", () => {
    expect(organizationUsageLabel(translate, "folderUsageLabel", "Research", 1)).toBe(
      "folderUsageLabelOne:Research|1",
    );
    expect(organizationUsageLabel(translate, "folderUsageLabel", "Research", 0)).toBe(
      "folderUsageLabel:Research|0",
    );
    expect(organizationUsageLabel(translate, "tagUsageLabel", "AI", 2)).toBe(
      "tagUsageLabel:AI|2",
    );
  });

  it("localizes Portuguese singular and plural nouns", () => {
    const messages = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "public/_locales/pt_BR/messages.json"),
        "utf8",
      ),
    ) as Record<string, { message: string }>;

    expect(messages.folderUsageLabelOne?.message).toContain("favorito");
    expect(messages.folderUsageLabel?.message).toContain("favoritos");
    expect(messages.tagUsageLabelOne?.message).toContain("favorito");
    expect(messages.tagUsageLabel?.message).toContain("favoritos");
  });
});
