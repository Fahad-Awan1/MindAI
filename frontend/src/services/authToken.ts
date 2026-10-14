/**
 * Login token storage. localStorage can be unavailable (private mode, blocked storage),
 * so every access is guarded and an in-memory copy is kept as a fallback.
 *
 * In the Android app the token (and the signed-in user) is also kept in the app's own storage
 * (Capacitor Preferences), which Android doesn't clear the way it may clear a WebView's localStorage,
 * so people stay signed in until they log out.
 */
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const TOKEN_KEY = 'mindai.token';
const USER_KEY = 'mindai.user';
const native = Capacitor.isNativePlatform();

let memoryToken: string | null = null;
const unauthorizedListeners = new Set<() => void>();

const readLocal = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeLocal = (key: string, value: string | null) => {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Ignore storage errors; the in-memory copy still works
  }
};

const writeNative = (key: string, value: string | null) => {
  if (!native) return;
  (value ? Preferences.set({ key, value }) : Preferences.remove({ key })).catch(() => {});
};

export const getToken = (): string | null => {
  if (memoryToken) return memoryToken;
  memoryToken = readLocal(TOKEN_KEY);
  return memoryToken;
};

export const setToken = (token: string | null) => {
  memoryToken = token;
  writeLocal(TOKEN_KEY, token);
  writeNative(TOKEN_KEY, token);
  if (!token) setCachedUser(null);
};

/** The last signed-in user, so the app can open straight away even when the server can't be reached. */
export const getCachedUser = <T,>(): T | null => {
  const raw = readLocal(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const setCachedUser = (user: unknown | null) => {
  const raw = user ? JSON.stringify(user) : null;
  writeLocal(USER_KEY, raw);
  writeNative(USER_KEY, raw);
};

/** Android app: bring back a session that only survived in the app's own storage. Resolves once done. */
export const restoreNativeSession = async (): Promise<void> => {
  if (!native || readLocal(TOKEN_KEY)) return;
  try {
    const [{ value: token }, { value: user }] = await Promise.all([
      Preferences.get({ key: TOKEN_KEY }),
      Preferences.get({ key: USER_KEY }),
    ]);
    if (token) {
      memoryToken = token;
      writeLocal(TOKEN_KEY, token);
      if (user) writeLocal(USER_KEY, user);
    }
  } catch {
    // No saved session
  }
};

export const authHeaders = (): Record<string, string> => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** Called when the server rejects the token (expired / signed out elsewhere). */
export const onUnauthorized = (listener: () => void) => {
  unauthorizedListeners.add(listener);
  return () => { unauthorizedListeners.delete(listener); };
};

export const notifyUnauthorized = () => unauthorizedListeners.forEach(listener => listener());
