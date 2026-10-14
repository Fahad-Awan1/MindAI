// Web vs. the Android app (Capacitor): the few places where the phone needs native behaviour
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Keyboard } from '@capacitor/keyboard';
import { Share } from '@capacitor/share';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { API_BASE_URL } from './api';
import { scrollToElement } from '../motion/useLenis';

export const isNative = Capacitor.isNativePlatform();

/** Where MindAI's web address is for links shared with others (the app itself runs on https://localhost). */
export const publicOrigin = (): string | null => {
  if (!isNative) return null;
  try {
    return new URL(API_BASE_URL).origin;
  } catch {
    return null;
  }
};

const toBase64 = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

/** Save a file: a normal download on the web, the share sheet (Drive, WhatsApp, Files…) in the app. */
export const saveFile = async (blob: Blob, name: string) => {
  if (isNative) {
    const written = await Filesystem.writeFile({ path: name, data: await toBase64(blob), directory: Directory.Cache });
    try {
      await Share.share({ title: name, files: [written.uri], dialogTitle: `Save or share ${name}` });
    } catch (err) {
      // Closing the share sheet without picking an app isn't a failure
      if (/cancel/i.test(err instanceof Error ? err.message : String(err))) return;
      throw err;
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
};

/** App start in the Android app: brand status bar, hide the native splash once React has painted. */
export const setupNative = () => {
  if (!isNative) return;
  document.documentElement.classList.add('native-app');
  StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  StatusBar.setBackgroundColor({ color: '#0b0a1a' }).catch(() => {});
  window.requestAnimationFrame(() => { SplashScreen.hide().catch(() => {}); });
  setupKeyboard();
};

// --- Keyboard: never let it cover the field being typed in -------------------------------------------

const isTextField = (el: Element | null): el is HTMLElement =>
  el instanceof HTMLElement && (el.tagName === 'TEXTAREA' || el.isContentEditable ||
    (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'range', 'file', 'color'].includes((el as HTMLInputElement).type)));

/** Scroll the focused field into the visible part of the screen if the keyboard hides it. */
const revealFocusedField = () => {
  const el = document.activeElement;
  if (!isTextField(el)) return;
  const visibleBottom = window.visualViewport ? window.visualViewport.offsetTop + window.visualViewport.height : window.innerHeight;
  const rect = el.getBoundingClientRect();
  if (rect.bottom > visibleBottom - 12 || rect.top < 0) scrollToElement(el, { offset: -96 });
};

/**
 * Phones (app and mobile browser): when a field gets focus or the visible area shrinks for the keyboard,
 * bring the field into view. In the app, if Android didn't shrink the page for the keyboard, leave room for it.
 */
const setupKeyboard = () => {
  if (!isNative) return;
  const root = document.documentElement;
  let heightBefore = window.innerHeight;
  Keyboard.addListener('keyboardWillShow', () => { heightBefore = window.innerHeight; }).catch(() => {});
  Keyboard.addListener('keyboardDidShow', info => {
    // Android should have resized the web view; if the page is still full height, the keyboard is on top of it
    if (window.innerHeight > heightBefore - info.keyboardHeight / 2) {
      root.style.setProperty('--keyboard-inset', `${info.keyboardHeight}px`);
      root.classList.add('keyboard-open');
    }
    window.setTimeout(revealFocusedField, 60);
  }).catch(() => {});
  Keyboard.addListener('keyboardWillHide', () => {
    root.classList.remove('keyboard-open');
    root.style.removeProperty('--keyboard-inset');
  }).catch(() => {});
};

/** Mobile browsers (and the app): reveal the field after focusing it and whenever the keyboard resizes the view. */
export const setupFocusReveal = () => {
  if (typeof window === 'undefined' || !window.matchMedia('(pointer: coarse)').matches) return;
  document.addEventListener('focusin', e => { if (isTextField(e.target as Element)) window.setTimeout(revealFocusedField, 350); });
  window.visualViewport?.addEventListener('resize', () => window.setTimeout(revealFocusedField, 50));
};

/** Android back button. `handler` returns true when it handled the press; otherwise the app closes. */
export const onBackButton = (handler: () => boolean) => {
  if (!isNative) return () => {};
  const listener = NativeApp.addListener('backButton', () => {
    if (!handler()) NativeApp.exitApp();
  });
  return () => { listener.then(l => l.remove()); };
};

/** An open dialog/menu gets closed with Escape (every modal in the app listens for it). */
export const closeTopDialog = (): boolean => {
  const open = document.querySelector('[role="dialog"], [aria-modal="true"], .dialog-panel');
  if (!open) return false;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return true;
};

// "Install app" (web): Chrome offers it through beforeinstallprompt, which can fire before React mounts - keep it here
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let installPrompt: InstallPrompt | null = null;
const installListeners = new Set<(available: boolean) => void>();
if (!isNative && typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installPrompt = e as InstallPrompt;
    installListeners.forEach(l => l(true));
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installListeners.forEach(l => l(false));
  });
}

/** Whether the browser can install MindAI right now; call with a listener to hear about changes. */
export const watchInstallable = (listener: (available: boolean) => void) => {
  installListeners.add(listener);
  listener(!!installPrompt);
  return () => { installListeners.delete(listener); };
};

export const promptInstall = async () => {
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = null;
  // Each prompt can be shown once; Chrome fires a new beforeinstallprompt later if it was dismissed
  installListeners.forEach(l => l(false));
  await prompt.prompt();
};
