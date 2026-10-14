// "Continue with Google": Google Identity Services on the web, the native Google sign-in sheet in the Android app.
// Both give a Google ID token that the backend verifies (POST /api/auth/google).
import { isNative } from '../services/platform';

export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
export const googleEnabled = !!GOOGLE_CLIENT_ID;

interface GsiCredentialResponse { credential: string }
interface GsiApi {
  accounts: {
    id: {
      initialize: (options: { client_id: string; callback: (response: GsiCredentialResponse) => void; ux_mode?: 'popup'; auto_select?: boolean; itp_support?: boolean }) => void;
      renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
    };
  };
}

let gsiLoading: Promise<GsiApi> | null = null;

/** Load Google's sign-in script once (web only). */
const loadGsi = (): Promise<GsiApi> => {
  const existing = (window as unknown as { google?: GsiApi }).google;
  if (existing?.accounts?.id) return Promise.resolve(existing);
  if (!gsiLoading) {
    gsiLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve((window as unknown as { google: GsiApi }).google);
      script.onerror = () => { gsiLoading = null; reject(new Error('Could not load Google sign-in. Check your connection.')); };
      document.head.appendChild(script);
    });
  }
  return gsiLoading;
};

/** Web: draw Google's own button into `parent`; `onToken` gets the ID token after the user picks an account. */
let tokenHandler: (idToken: string) => void = () => {};
let gsiInitialized = false;

export const renderGoogleButton = async (parent: HTMLElement, onToken: (idToken: string) => void, width: number) => {
  const gsi = await loadGsi();
  tokenHandler = onToken;
  // Initialise once per page load (Google warns when it happens again); the latest button's handler gets the token
  if (!gsiInitialized) {
    gsi.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: r => tokenHandler(r.credential), ux_mode: 'popup', itp_support: true });
    gsiInitialized = true;
  }
  parent.innerHTML = '';
  gsi.accounts.id.renderButton(parent, {
    type: 'standard', theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', logo_alignment: 'center',
    width: Math.max(200, Math.min(400, Math.round(width))),
  });
};

let nativeReady: Promise<void> | null = null;

/** Android app: open the native Google account picker and return its ID token (null when the user cancels). */
export const nativeGoogleSignIn = async (): Promise<string | null> => {
  const { SocialLogin } = await import('@capgo/capacitor-social-login');
  if (!nativeReady) nativeReady = SocialLogin.initialize({ google: { webClientId: GOOGLE_CLIENT_ID } }).then(() => undefined);
  await nativeReady;
  try {
    const response = await SocialLogin.login({ provider: 'google', options: {} });
    const result = response.result as { idToken?: string | null };
    return result.idToken || null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/cancel/i.test(message)) return null;
    throw err;
  }
};

export const useNativeGoogle = isNative;
