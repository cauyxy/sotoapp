import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  clearScreen: false,
  resolve: {
    conditions: ["browser"]
  },
  server: {
    host: "127.0.0.1",
    port: 6782,
    strictPort: true,
    fs: {
      allow: ["../.."]
    }
  },
  envPrefix: ["VITE_", "TAURI_"],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  },
  build: {
    target: "es2022",
    rollupOptions: {
      // Two HTML entries. Rollup builds each transitive graph separately and
      // automatically code-splits shared chunks so the Svelte runtime and any
      // shared UI primitives are downloaded once per webview.
      input: {
        main: "index.html",
        capsule: "capsule.html"
      }
    }
  }
});
