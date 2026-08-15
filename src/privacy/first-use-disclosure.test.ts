import { describe, expect, it, vi } from "vitest";

import {
  FIRST_USE_DISCLOSURE_VERSION,
  FirstUseDisclosureRepository,
} from "./first-use-disclosure";

describe("FirstUseDisclosureRepository", () => {
  it("keeps post processing disabled until the current disclosure is accepted", async () => {
    const values: Record<string, unknown> = {};
    const repository = new FirstUseDisclosureRepository({
      get: vi.fn(async (key: string) => ({ [key]: values[key] })),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(values, items);
      }),
    });

    await expect(repository.status()).resolves.toEqual({
      accepted: false,
      version: FIRST_USE_DISCLOSURE_VERSION,
    });

    await repository.accept(new Date("2026-08-15T01:30:00.000Z"));

    await expect(repository.status()).resolves.toEqual({
      accepted: true,
      version: FIRST_USE_DISCLOSURE_VERSION,
    });
  });

  it("requires acceptance again when a stored disclosure has an older version", async () => {
    const repository = new FirstUseDisclosureRepository({
      get: vi.fn(async (key: string) => ({
        [key]: { version: 0, acceptedAt: "2026-08-01T10:00:00.000Z" },
      })),
      set: vi.fn(async () => undefined),
    });

    await expect(repository.status()).resolves.toEqual({
      accepted: false,
      version: FIRST_USE_DISCLOSURE_VERSION,
    });
  });
});
