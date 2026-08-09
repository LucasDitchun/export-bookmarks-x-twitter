import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    copyPublicDir: false,
    sourcemap: false,
    lib: {
      entry: resolve(import.meta.dirname, "src/content/content-script.ts"),
      name: "BookmarkXContentScript",
      formats: ["iife"],
      fileName: () => "content-script.js",
    },
  },
});
