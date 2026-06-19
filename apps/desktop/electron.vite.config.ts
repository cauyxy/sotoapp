import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

// @soto/core, @soto/ipc and @soto/native-bridge ship raw TS (main: src/index.ts),
// so they must be bundled + transpiled rather than externalized like a normal
// node_modules dep. (koffi, the native addon @soto/native-bridge requires, is
// still externalized — it is a real node_modules dep electron-builder packages.)
const bundleCore = externalizeDepsPlugin({
  exclude: ["@soto/core", "@soto/ipc", "@soto/native-bridge"],
});

export default defineConfig({
  main: {
    plugins: [bundleCore],
    build: {
      minify: "esbuild",
      rollupOptions: {
        input: { index: resolve("src/main/bootstrap/index.ts") },
      },
    },
  },
  preload: {
    plugins: [bundleCore],
    build: {
      minify: "esbuild",
      rollupOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
          capsule: resolve("src/preload/capsule.ts"),
        },
      },
    },
  },
  renderer: {
    plugins: [react()],
    build: {
      minify: "esbuild",
      rollupOptions: {
        input: {
          index: resolve("src/renderer/index.html"),
          capsule: resolve("src/renderer/capsule.html"),
        },
      },
    },
  },
});
