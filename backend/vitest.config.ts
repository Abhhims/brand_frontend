import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    env: { NODE_ENV: "test", LOG_LEVEL: "silent" },
    // end-to-end tests hash real images and hit Postgres/Redis/S3; allow for a busy machine
    testTimeout: 20_000,
  },
})
