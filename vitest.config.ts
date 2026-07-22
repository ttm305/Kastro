import { defineConfig } from 'vitest/config'

// Default environment is 'node' -- most tests here are pure logic (Ludo
// rules engine, avatar-frame geometry) with no DOM needed, which keeps the
// suite fast. Component tests that DO need a DOM (e.g.
// src/components/Avatar.test.tsx) opt into jsdom per-file via a
// `// @vitest-environment jsdom` comment at the top of that file instead
// of paying the jsdom cost for the whole suite.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
