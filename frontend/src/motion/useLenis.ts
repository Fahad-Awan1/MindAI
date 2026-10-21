import { useEffect, useRef } from 'react';
import Lenis from 'lenis';
import { prefersReducedMotion } from './index';

/**
 * Inertial smooth scrolling (Lenis) for a scroll container. Nested scrollable panels,
 * dialogs and anything marked data-lenis-prevent keep native scrolling.
 * Returns a ref for the wrapper element; pass `enabled = false` for views that manage their own scroll.
 */
const hasFinePointer = () => {
  try {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  } catch {
    return false;
  }
};

// The page's smooth scroller, if one is running (so other code can scroll through it instead of fighting it)
let activeLenis: Lenis | null = null;

/** Bring an element into view inside the app's scroll area (smoothly, unless `immediate`). */
export function scrollToElement(el: HTMLElement, { offset = -120, immediate = false } = {}) {
  if (activeLenis && activeLenis.options.wrapper instanceof HTMLElement && activeLenis.options.wrapper.contains(el)) {
    activeLenis.resize();
    activeLenis.scrollTo(el, { offset, immediate });
  } else {
    el.scrollIntoView({ behavior: immediate ? 'auto' : 'smooth', block: 'center' });
  }
}

export function useLenis<T extends HTMLElement>(enabled: boolean, resetKey?: unknown) {
  const wrapperRef = useRef<T | null>(null);
  const lenisRef = useRef<Lenis | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    // Mouse / trackpad only. Touch screens already scroll natively with momentum; there Lenis would only add a
    // callback on every animation frame, forever, costing a phone's CPU and battery for nothing.
    if (!enabled || !wrapper || prefersReducedMotion() || !hasFinePointer()) return;
    const content = wrapper.firstElementChild as HTMLElement | null;
    if (!content) return;
    const lenis = new Lenis({
      wrapper,
      content,
      lerp: 0.1,
      smoothWheel: true,
      allowNestedScroll: true,
      autoRaf: true,
      prevent: (node: HTMLElement) =>
        !!node.closest?.('[data-lenis-prevent], [role="dialog"], textarea, select, .cy-container, .mermaid'),
    });
    lenisRef.current = lenis;
    activeLenis = lenis;
    return () => {
      lenis.destroy();
      lenisRef.current = null;
      if (activeLenis === lenis) activeLenis = null;
    };
  }, [enabled]);

  // New screen: start at the top
  useEffect(() => {
    if (lenisRef.current) lenisRef.current.scrollTo(0, { immediate: true });
    else if (wrapperRef.current) wrapperRef.current.scrollTop = 0;
  }, [resetKey]);

  return wrapperRef;
}
