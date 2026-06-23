import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        main: "./src/index.ts",
        miniflare: {
          compatibilityDate: "2025-10-11",
          assets: { directory: "./test/fixtures-site", binding: "ASSETS" },
        },
      },
    },
  },
});
