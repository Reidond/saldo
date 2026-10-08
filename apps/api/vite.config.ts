import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    // Suites that use a real local D1 start workerd in beforeAll.
    hookTimeout: 60_000,
    testTimeout: 20_000,
  },
});
