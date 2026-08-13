export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isBookmarkId(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/.test(value);
}

export function isLocalEntityId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

export function isFolderName(value: unknown): value is string {
  const hasControlCharacters =
    typeof value === "string" &&
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    });
  return (
    typeof value === "string" &&
    value.trim().length >= 1 &&
    value.trim().length <= 100 &&
    !hasControlCharacters
  );
}

export function isTagName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 200 &&
    value.trim().length > 0 &&
    value.trim().normalize("NFKC").length <= 50 &&
    !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  );
}

export function isBookmarksUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      (url.hostname === "x.com" || url.hostname === "www.x.com") &&
      (url.pathname === "/i/bookmarks" || url.pathname.startsWith("/i/bookmarks/"))
    );
  } catch {
    return false;
  }
}

export function isXUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname;
    return hostname === "x.com" || hostname === "www.x.com";
  } catch {
    return false;
  }
}
