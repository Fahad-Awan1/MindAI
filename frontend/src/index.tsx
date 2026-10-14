import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import './styles/tailwind.css';
import './index.css';
import './styles/motion.css';
import { isNative, setupFocusReveal, setupNative } from './services/platform';

setupNative();
setupFocusReveal();
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
