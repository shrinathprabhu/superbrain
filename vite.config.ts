import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  /*
   * The app has a subdomain to itself, so it serves from the root. Deep links
   * mean this must be absolute rather than relative: a relative bundle path
   * would resolve against the note route instead of the app.
   */
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
      /*
       * Deliberately not 'autoUpdate'. That mode reloads the page the moment a
       * new worker activates, and note bodies are held in memory until an
       * explicit save, so a deploy landing mid-sentence would throw the edit
       * away. The app asks instead, and applies the update once the editor says
       * it is safe. See src/lib/sw.ts.
       */
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'],
      workbox: {
        // The new worker waits. Taking over early would let cleanupOutdatedCaches
        // drop the lazy chunks (NoteEditor, GraphView, export) that the running
        // page has not imported yet, breaking them until a reload.
        skipWaiting: false,
        // Harmless with skipWaiting off, and it makes the very first visit
        // offline-ready without waiting for a second navigation.
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The social card is for crawlers and link unfurls, never for the app
        // itself. Precaching it would cost every visitor 57 kB they never see.
        globIgnores: ['**/og.png'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // Deep links have to resolve to the app shell offline, exactly as the
        // host rewrites them online.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/_superbrain\//],
      },
      manifest: {
        id: '/',
        name: 'Superbrain: local-first markdown notes',
        short_name: 'Superbrain',
        description:
          'A markdown notes app that runs entirely in your browser. Backlinks, tags, comments and a graph view over ordinary .md files. No account, no server, works offline.',
        categories: ['productivity', 'utilities'],
        lang: 'en',
        dir: 'ltr',
        theme_color: '#0e1017',
        background_color: '#0e1017',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        screenshots: [
          {
            src: '/og.png',
            sizes: '1200x630',
            type: 'image/png',
            form_factor: 'wide',
            label: 'Superbrain, local-first markdown notes in your browser',
          },
        ],
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
