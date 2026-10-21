import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
// Self-hosted fonts: served with the app (cached with it), each file loaded only when a page uses it
import '@fontsource-variable/inter';
import '@fontsource-variable/outfit';
import '@fontsource-variable/crimson-pro';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import './styles/tailwind.css';
import './index.css';
import './styles/motion.css';
import { isNative, setupFocusReveal, setupNative } from './services/platform';
import { API_BASE_URL } from './services/api';

setupNative();
setupFocusReveal();
// The API lives on another address (the hosted web app, the Android app): open the connection (DNS, TLS)
// right away, while the app is still starting, so the first request doesn't pay for it
if (API_BASE_URL) {
  try {
    const origin = new URL(API_BASE_URL).origin;
    for (const rel of ['preconnect', 'dns-prefetch']) {
      const link = document.createElement('link');
      link.rel = rel;
      link.href = origin;
      if (rel === 'preconnect') link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    }
  } catch {
    // Not a valid URL: requests will report the problem
  }
}
// Installable web app: cache the app shell (production web build only - the phone app ships its own files)
if (!isNative && import.meta.env.PROD) {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => {});
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
