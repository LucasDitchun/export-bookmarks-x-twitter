import { describe, expect, it } from "vitest";

import { getTagBadgeColors } from "./tag-colors";

function luminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(left: string, right: string): number {
  const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe("getTagBadgeColors", () => {
  it("returns a deterministic WCAG AA foreground/background pair", () => {
    const first = getTagBadgeColors("accessibility");
    const repeated = getTagBadgeColors("accessibility");

    expect(repeated).toEqual(first);
    expect(contrast(first.background, first.foreground)).toBeGreaterThanOrEqual(4.5);

    const palette = new Map<string, ReturnType<typeof getTagBadgeColors>>();
    for (let index = 0; index < 1_000; index += 1) {
      const colors = getTagBadgeColors(`tag-${index}`);
      palette.set(colors.background, colors);
    }
    expect(palette.size).toBeGreaterThan(1);
    for (const colors of palette.values()) {
      expect(contrast(colors.background, colors.foreground)).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });
});
