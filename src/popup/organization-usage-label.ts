import type { Translator } from "./i18n";

type UsageLabelKey = "folderUsageLabel" | "tagUsageLabel";

export function organizationUsageLabel(
  translate: Translator,
  key: UsageLabelKey,
  name: string,
  count: number,
): string {
  const messageKey = count === 1 ? `${key}One` : key;
  return translate(messageKey, [name, String(count)]);
}
