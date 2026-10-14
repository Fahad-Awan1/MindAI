import { useEffect, useRef } from 'react';

/**
 * Handlers for "go back": the Android back button and the Escape key. Open dialogs, sheets and screens that
 * must confirm before leaving (an exam in progress) register one; only the most recently registered
 * (top-most) one runs. A handler returns false to let the press fall through to the next one.
 */
type BackHandler = () => boolean | void;
const stack: { handler: React.MutableRefObject<BackHandler> }[] = [];

/** Run the top-most back handler. Returns true when something handled the press. */
export const handleBack = (): boolean => {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].handler.current() !== false) return true;
  }
  return false;
};

// Escape on the web/desktop does the same as the Android back button for anything registered
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented || !stack.length) return;
    if (handleBack()) e.preventDefault();
  });
}

/** Register `handler` for back / Escape while `active` (default: while mounted). */
export const useBackHandler = (handler: BackHandler, active = true) => {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active) return;
    const entry = { handler: ref };
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [active]);
};
