import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [svelte(), tailwindcss(), svelteTesting()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true
  },
  resolve: {
    conditions: ["browser", "module", "svelte", "default"]
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    globals: false,
    resolve: {
      conditions: ["browser", "module", "svelte", "default"]
    }
  }
});
