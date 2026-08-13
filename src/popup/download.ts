import type { ExportResult } from "./protocol";

export function downloadExport(result: ExportResult): void {
  const type = result.filename.endsWith(".json")
    ? "application/json;charset=utf-8"
    : result.filename.endsWith(".md")
      ? "text/markdown;charset=utf-8"
      : "text/plain;charset=utf-8";
  const blob = new Blob([result.content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
