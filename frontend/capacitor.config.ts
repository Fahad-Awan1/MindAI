import type { CapacitorConfig } from '@capacitor/cli';

// MindAI's Android app: the same React build (dist/), loaded from https://localhost inside the app.
// The backend address is baked in at build time from .env.mobile (VITE_API_URL) - see docs/MOBILE.md.
const config: CapacitorConfig = {
  appId: 'com.mindai.app',
  appName: 'MindAI',
  webDir: 'dist',
  android: {
    // Android 15 draws apps edge-to-edge; keep the web view clear of the status and navigation bars on every phone
    adjustMarginsForEdgeToEdge: 'force',
  },
  plugins: {
    // The app draws edge-to-edge, where Android stops shrinking the web view for the keyboard; this restores it
    Keyboard: {
      resizeOnFullScreen: true,
    },
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#0b0a1a',
      showSpinner: false,
    },
  },
};

export default config;
