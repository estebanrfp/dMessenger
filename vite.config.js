import { defineConfig } from 'vite'
import UnoCSS from 'unocss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// The engine is loaded from the official CDN (pinned), never bundled: its
// optional modules (sm, sm-acls, sm-gov, genosrtc) resolve relative to the
// engine file itself, so they must stay next to it on the CDN. For the app to
// open with no network at all, the service worker caches that origin too.
const ENGINE_VERSION = '0.36.3'
const ENGINE_BASE = `https://cdn.jsdelivr.net/npm/genosdb@${ENGINE_VERSION}/dist/`
const ENGINE_ORIGIN = /^https:\/\/cdn\.jsdelivr\.net\/npm\/genosdb@/
// The engine plus the optional modules it loads relative to itself. Precached
// at install: on a first load the module import fires before the worker
// controls the page, so runtime caching alone would leave the cache empty.
const ENGINE_FILES = ['index.min.js', 'sm.min.js', 'sm-acls.min.js', 'sm-gov.min.js', 'genosrtc.min.js']

export default defineConfig({
  plugins: [
    UnoCSS(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.svg'],
      manifest: {
        name: 'dMessenger',
        short_name: 'dMessenger',
        description: 'Serverless, private messaging on one GenosDB graph',
        start_url: '/',
        display: 'standalone',
        background_color: '#09090c',
        theme_color: '#09090c',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        additionalManifestEntries: ENGINE_FILES.map(file => ({ url: ENGINE_BASE + file, revision: ENGINE_VERSION })),
        navigateFallback: '/index.html',
        runtimeCaching: [{
          urlPattern: ({ url }) => ENGINE_ORIGIN.test(url.href),
          handler: 'CacheFirst',
          options: { cacheName: 'genosdb-engine', expiration: { maxEntries: 16 }, cacheableResponse: { statuses: [0, 200] } },
        }],
      },
    }),
  ],
  build: { target: 'es2022' },
  server: { port: 5605, strictPort: true },
  preview: { port: 5608, strictPort: true },
})
