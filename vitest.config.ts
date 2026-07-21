import { defineConfig } from 'vitest/config'

// Pure-logic tests only (Ludo rules engine, geometry) — no DOM needed, so
// the default 'node' environment is fine and keeps the suite fast.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
