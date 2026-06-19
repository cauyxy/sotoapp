import { defineConfig } from "vitest/config";

// Default Vitest config is node-oriented, while renderer tests can opt into
// jsdom with per-file annotations. Keep both .ts and .tsx test files discoverable.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
