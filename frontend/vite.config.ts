/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Type-only API contract shared with the backend.
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  build: {
    // The bite page's chunk is ~800 kB because Sandpack (an in-browser bundler) lives there; it
    // is lazy-loaded only on that route, so the entry bundle stays ~200 kB.
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
