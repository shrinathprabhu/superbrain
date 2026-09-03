import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Real paths mean deep links must resolve the bundle from the site root, so
  // the base has to be absolute. Serving from a subdirectory means setting this
  // to that subpath; the router reads it back from import.meta.env.BASE_URL.
  base: '/',
  build: {
    // Kept off the generic /assets/ path: a note vault very often has its own
    // `assets` folder, and that would route straight into the build output.
    assetsDir: '_superbrain',
    rollupOptions: {
      output: {
        // Split the editor engine out from app code so a UI change doesn't
        // invalidate the (much larger, much more stable) ProseMirror bundle.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('prosemirror') || id.includes('@tiptap') || id.includes('tiptap-markdown')) return 'editor'
          if (id.includes('react')) return 'react'
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // Deep links have to resolve to the app shell offline, exactly as the
        // host rewrites them online.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/_superbrain\//],
      },
      manifest: {
        name: 'Superbrain',
        short_name: 'Superbrain',
        description: 'Local-first markdown notes with linking and a graph view. No server, no account.',
        theme_color: '#0f1115',
        background_color: '#0f1115',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
