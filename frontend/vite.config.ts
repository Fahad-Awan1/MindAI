import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The backend MindAI talks to (proxied, so the app and API share one origin - this lets
// friends on your network or through a tunnel reach everything via a single address)
const BACKEND_URL = process.env.MINDAI_BACKEND_URL || 'http://localhost:8000';

export default defineConfig({
  plugins: [
    react(),
    // Installable app: precache the app shell so it opens instantly (and offline); the API always goes to the network.
    // public/site.webmanifest stays the manifest; the service worker is registered in index.tsx (web only).
    VitePWA({
      manifest: false,
      injectRegister: false,
      registerType: 'autoUpdate',
      workbox: {
        // Only the app shell is downloaded up front (page, main code + styles, icons). Pre-storing every screen
        // meant ~3.7 MB in the background on the first visit (and again after each update), hogging slow phone
        // connections right when people start using the app. Screens are kept the first time they're opened.
        globPatterns: ['index.html', 'assets/index-*.{js,css}', '*.{svg,ico,png,webmanifest}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            // Screen code, styles and images: file names change with their content, so a stored copy never goes stale
            urlPattern: ({ url, sameOrigin }) => sameOrigin && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/team/')),
            handler: 'CacheFirst',
            options: { cacheName: 'mindai-assets', expiration: { maxEntries: 250, maxAgeSeconds: 60 * 60 * 24 * 60 } },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts', expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
  define: {
    'process.env': {}
  },
  server: {
    port: 5173,
    // Listen on the local network so classmates can open http://<your-ip>:5173
    host: true,
    // Allow Cloudflare / ngrok tunnel hostnames (for friends outside your network)
    allowedHosts: ['localhost', '.trycloudflare.com', '.ngrok-free.app', '.ngrok.app'],
    // The Android project holds a copy of the built app - don't reload when `cap sync` rewrites it
    watch: { ignored: ['**/android/**', '**/dist/**'] },
    proxy: {
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
        ws: true, // Study room WebSockets
      },
    },
  },
});
