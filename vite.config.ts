import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Vite config — https://vitejs.dev/config/
//
// This project originally ran inside the Figma Make authoring
// environment, which injected several dev-only plugins (site-config
// injection from a `.figma/make/site.json` that only exists inside that
// environment, an error-overlay relay, an HMR-boundary fallback, and a
// "make kit" preview harness). None of those apply once the app is
// deployed standalone, so this config keeps only what a production
// Vite + React + Tailwind v4 app actually needs.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: parseInt(process.env.PORT || '8443'),
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: parseInt(process.env.PORT || '8443'),
  },
})
