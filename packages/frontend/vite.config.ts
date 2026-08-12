import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// Vite config for the Personal Space PWA. The dev server proxies /api to the local Worker so the
// app runs on one origin in development exactly as it does in production, where the Worker serves
// this build output from packages/frontend/dist as static assets.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Personal Space',
        short_name: 'Personal Space',
        description: 'A personal workspace for pages, notes and databases.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f7f6f3',
        theme_color: '#16151b',
        icons: [
          // Future: replace the single scalable icon with rasterised 192/512 PNGs when the icon
          // artwork is finalised; Chrome accepts an "any"-sized SVG for installability today.
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Future: add a runtime cache for /api/workspaces/:id/snapshot and wire Background Sync to
        // the durable op queue when Phase 6 lands offline editing.
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        navigateFallback: '/index.html',
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: true },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    css: false,
  },
});
