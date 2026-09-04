import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  /*
   * The app is published at lowkey.tools/superbrain, which proxies through to
   * this project's own origin and strips the prefix on the way. So every URL
   * the page emits has to carry `/superbrain/`: that is what the browser asks
   * lowkey.tools for, and the proxy hands the rest to this origin at its root.
   *
   * Deep links mean these must be absolute rather than relative, since a
   * relative bundle path would resolve against the note route instead of the
   * app. The router reads this back from import.meta.env.BASE_URL.
   */
  base: '/superbrain/',
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
        // The social card is for crawlers and link unfurls, never for the app
        // itself. Precaching it would cost every visitor 57 kB they never see.
        globIgnores: ['**/og.png'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // Deep links have to resolve to the app shell offline, exactly as the
        // host rewrites them online.
        navigateFallback: 'index.html',
        // Matches the built asset path whether or not the base prefix is present.
        navigateFallbackDenylist: [/(^|\/)_superbrain\//],
      },
      manifest: {
        id: '/superbrain/',
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
        start_url: '/superbrain/',
        scope: '/superbrain/',
        screenshots: [
          {
            src: '/superbrain/og.png',
            sizes: '1200x630',
            type: 'image/png',
            form_factor: 'wide',
            label: 'Superbrain, local-first markdown notes in your browser',
          },
        ],
        icons: [
          { src: '/superbrain/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/superbrain/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/superbrain/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
