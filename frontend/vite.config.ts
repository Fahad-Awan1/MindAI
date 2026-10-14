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
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
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
