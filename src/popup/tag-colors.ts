export interface TagBadgeColors {
  background: string;
  foreground: string;
  border: string;
}

const ACCESSIBLE_TAG_COLORS: readonly TagBadgeColors[] = [
  { background: "#b6e3ff", foreground: "#111111", border: "#0969da" },
  { background: "#f8d5b5", foreground: "#111111", border: "#9a6700" },
  { background: "#d4c5f9", foreground: "#111111", border: "#8250df" },
  { background: "#acf2bd", foreground: "#111111", border: "#1a7f37" },
  { background: "#f9d0c4", foreground: "#111111", border: "#cf222e" },
  { background: "#fff1a8", foreground: "#111111", border: "#9a6700" },
  { background: "#c7ede6", foreground: "#111111", border: "#0a6f68" },
  { background: "#e7d7b5", foreground: "#111111", border: "#6f5428" },
];

export function getTagBadgeColors(identity: string): TagBadgeColors {
  let hash = 2_166_136_261;
  for (const character of identity.normalize("NFKC")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return ACCESSIBLE_TAG_COLORS[(hash >>> 0) % ACCESSIBLE_TAG_COLORS.length]!;
}
