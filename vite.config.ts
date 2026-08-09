import { resolve } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  worker: { format: "es" },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: resolve(import.meta.dirname, "popup.html"),
        options: resolve(import.meta.dirname, "options.html"),
        sidepanel: resolve(import.meta.dirname, "sidepanel.html"),
        "service-worker": resolve(
          import.meta.dirname,
          "src/background/service-worker.ts",
        ),
        "content-script": resolve(import.meta.dirname, "src/content/content-script.ts"),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "service-worker" || chunk.name === "content-script"
            ? `${chunk.name}.js`
            : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  test: {
    environment: "node",
    exclude: [
      ...configDefaults.exclude,
      ".github/scripts/release-train.test.mjs",
      "scripts/semantic-model-gate.test.mjs",
      "scripts/semantic-browser-gate.node-test.mjs",
    ],
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 75,
      },
      exclude: ["src/test/**", "src/popup/main.ts", "src/background/service-worker.ts"],
    },
  },
});
