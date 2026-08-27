import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    testTimeout: 5_000,
    hookTimeout: 5_000,
    include: ["{apps,modules,packages}/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "**/tests/e2e/**",
      "**/tests/visual/**",
      "tests/e2e/**",
    ],
  },
});
