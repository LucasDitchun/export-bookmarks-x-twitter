import { describe, expect, it } from "vitest";

import { isFullReviewDue } from "./review-schedule";

describe("isFullReviewDue", () => {
  it("becomes due at thirty elapsed days", () => {
    const completedAt = "2026-07-01T12:00:00.000Z";

    expect(isFullReviewDue(completedAt, new Date("2026-07-31T11:59:59.999Z"))).toBe(
      false,
    );
    expect(isFullReviewDue(completedAt, new Date("2026-07-31T12:00:00.000Z"))).toBe(
      true,
    );
  });

  it("uses elapsed instants instead of local calendar or timezone boundaries", () => {
    expect(
      isFullReviewDue(
        "2026-03-01T00:00:00.000+09:00",
        new Date("2026-03-30T15:00:00.000Z"),
      ),
    ).toBe(true);
  });

  it("does not remind before the first successful full review", () => {
    expect(isFullReviewDue(null, new Date("2026-07-31T12:00:00.000Z"))).toBe(false);
    expect(isFullReviewDue("invalid", new Date("2026-07-31T12:00:00.000Z"))).toBe(
      false,
    );
  });
});
