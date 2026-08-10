import type { StorageArea } from "../storage/extension-state";

export const DATE_TIME_PREFERENCES_KEY = "dateTimePreferences";

export type DateFormat = "auto" | "dmy" | "mdy" | "ymd";
export type TimeFormat = "auto" | "24h" | "12h";

export interface DateTimePreferences {
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
}

export const DEFAULT_DATE_TIME_PREFERENCES: Readonly<DateTimePreferences> =
  Object.freeze({
    dateFormat: "auto",
    timeFormat: "auto",
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizeDateTimePreferences(
  value: unknown,
  fallback: DateTimePreferences = DEFAULT_DATE_TIME_PREFERENCES,
): DateTimePreferences {
  const stored = isRecord(value) ? value : {};
  const dateFormat = stored.dateFormat;
  const timeFormat = stored.timeFormat;

  return {
    dateFormat:
      dateFormat === "auto" ||
      dateFormat === "dmy" ||
      dateFormat === "mdy" ||
      dateFormat === "ymd"
        ? dateFormat
        : fallback.dateFormat,
    timeFormat:
      timeFormat === "auto" || timeFormat === "24h" || timeFormat === "12h"
        ? timeFormat
        : fallback.timeFormat,
  };
}

export async function loadDateTimePreferences(
  storage: Pick<StorageArea, "get">,
): Promise<DateTimePreferences> {
  const values = await storage.get(DATE_TIME_PREFERENCES_KEY);
  return sanitizeDateTimePreferences(values[DATE_TIME_PREFERENCES_KEY]);
}

export async function saveDateTimePreferences(
  storage: Pick<StorageArea, "set">,
  preferences: DateTimePreferences,
): Promise<void> {
  await storage.set({ [DATE_TIME_PREFERENCES_KEY]: preferences });
}

function dateParts(date: Date, locale: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    })
      .formatToParts(date)
      .filter(({ type }) => type === "day" || type === "month" || type === "year")
      .map(({ type, value }) => [type, value]),
  );
}

export function formatRegionalDate(
  date: Date,
  locale: string,
  format: DateFormat,
): string {
  if (format === "auto") {
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date);
  }

  const parts = dateParts(date, locale);
  const ordered =
    format === "dmy"
      ? [parts.day, parts.month, parts.year]
      : format === "mdy"
        ? [parts.month, parts.day, parts.year]
        : [parts.year, parts.month, parts.day];
  return ordered.join("/");
}

export function formatRegionalTime(
  date: Date,
  locale: string,
  format: TimeFormat,
): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    ...(format === "auto" ? {} : { hour12: format === "12h" }),
  }).format(date);
}
