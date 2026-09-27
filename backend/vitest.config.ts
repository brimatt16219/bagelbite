import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // PGlite boots a WASM Postgres per test file; give slow CI machines headroom.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
