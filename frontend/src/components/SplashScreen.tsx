import React, { useEffect, useState } from 'react';
import { prefersReducedMotion } from '../motion';
import { isNative } from '../services/platform';

const SEEN_KEY = 'mindai.splashSeen';

/** The splash plays once per browser session (never under reduced motion, and never in the Android app,
 *  which already shows its own native splash). */
export const shouldShowSplash = (): boolean => {
  if (prefersReducedMotion() || isNative) return false;
  try {
    return window.sessionStorage.getItem(SEEN_KEY) !== '1';
  } catch {
    return true;
  }
};

const markSeen = () => {
  try {
    window.sessionStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Storage unavailable: the splash may play again next load, which is harmless
  }
};

const WORDS = ['Read', 'Ask', 'Quiz', 'Remember', 'Master'];

interface SplashScreenProps {
  /** Hold at 100% until the app is ready (e.g. the session has been restored) */
  ready: boolean;
  onDone: () => void;
}

/**
 * Opening sequence: the logo draws itself, a percentage counter runs to 100 while study verbs cycle,
 * then violet panels sweep up and the whole screen wipes away to reveal the app.
 */
export const SplashScreen: React.FC<SplashScreenProps> = ({ ready, onDone }) => {
  const [progress, setProgress] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [wordIndex, setWordIndex] = useState(0);

  // Counter: eased progress over ~2.2s, waiting at 96% until the app is ready
  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const DURATION = 2200;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      const eased = 1 - Math.pow(1 - t, 3);
      setProgress(prev => Math.max(prev, Math.round(eased * 96)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setWordIndex(i => (i + 1) % WORDS.length), 520);
    return () => window.clearInterval(id);
  }, []);

  // Finish: jump to 100, then play the exit sweep
  useEffect(() => {
    if (!ready || progress < 96 || leaving) return;
    setProgress(100);
    const exitTimer = window.setTimeout(() => setLeaving(true), 380);
    return () => window.clearTimeout(exitTimer);
  }, [ready, progress, leaving]);

  useEffect(() => {
    if (!leaving) return;
    markSeen();
    const doneTimer = window.setTimeout(onDone, 1100);
    return () => window.clearTimeout(doneTimer);
  }, [leaving, onDone]);

  // Let people skip it
  useEffect(() => {
    const skip = () => setLeaving(true);
    window.addEventListener('keydown', skip, { once: true });
    return () => window.removeEventListener('keydown', skip);
  }, []);

  return (
    <div
      className={`splash grain no-print ${leaving ? 'is-leaving' : ''}`}
      role="status"
      aria-label="Loading MindAI"
      onClick={() => progress > 40 && setLeaving(true)}
    >
      <div className="splash__glow" />
      <div className="absolute inset-0 dot-grid opacity-[0.08]" />

      {/* Corner details */}
      <div className="absolute top-6 left-6 md:top-8 md:left-10 text-[11px] uppercase tracking-[0.25em] text-white/50 splash__fade" style={{ animationDelay: '0.3s' }}>
        MindAI / Study companion
      </div>
      <div className="absolute top-6 right-6 md:top-8 md:right-10 text-[11px] uppercase tracking-[0.25em] text-white/50 splash__fade" style={{ animationDelay: '0.4s' }}>
        Est. {new Date().getFullYear()}
      </div>

      {/* Centre: animated mark + wordmark */}
      <div className="relative flex flex-col items-center">
        <svg width="112" height="112" viewBox="0 0 64 64" className="splash__mark drop-shadow-[0_20px_50px_rgba(124,58,237,0.55)]" aria-hidden="true">
          <defs>
            <linearGradient id="splash-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#8b5cf6" />
              <stop offset="1" stopColor="#4f46e5" />
            </linearGradient>
          </defs>
          <rect className="tile" width="64" height="64" rx="16" fill="url(#splash-grad)" />
          <path d="M17 45V20l15 15 15-15v25" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <circle className="node" cx="17" cy="45" r="4.5" fill="#fff" style={{ animationDelay: '0.45s' }} />
          <circle className="node" cx="17" cy="20" r="4.5" fill="#fff" style={{ animationDelay: '0.75s' }} />
          <circle className="node" cx="47" cy="20" r="4.5" fill="#fff" style={{ animationDelay: '1.15s' }} />
          <circle className="node" cx="47" cy="45" r="4.5" fill="#fff" style={{ animationDelay: '1.4s' }} />
          <circle className="spark" cx="32" cy="35" r="6" fill="#fbbf24" stroke="#fff" strokeWidth="2.5" />
        </svg>

        <div className="mt-8 overflow-hidden">
          <h1 className="font-display font-bold text-5xl md:text-7xl tracking-tight leading-none flex">
            {'Mind'.split('').map((c, i) => (
              <span key={i} className="inline-block animate-rise" style={{ animationDelay: `${0.6 + i * 0.06}s` }}>{c}</span>
            ))}
            {'AI'.split('').map((c, i) => (
              <span key={`a${i}`} className="inline-block animate-rise font-elegant italic font-normal text-violet-300 ml-[0.02em]" style={{ animationDelay: `${0.9 + i * 0.06}s` }}>{c}</span>
            ))}
          </h1>
        </div>

        <div className="mt-5 h-7 overflow-hidden text-white/70 text-lg font-elegant italic splash__fade" style={{ animationDelay: '1.1s' }}>
          <span key={wordIndex} className="inline-block animate-rise">{WORDS[wordIndex]}.</span>
        </div>
      </div>

      {/* Bottom: counter + progress bar */}
      <div className="absolute bottom-6 left-6 right-6 md:bottom-10 md:left-10 md:right-10 flex items-end justify-between gap-6">
        <div className="text-[11px] uppercase tracking-[0.25em] text-white/50 max-w-[14rem] leading-relaxed splash__fade" style={{ animationDelay: '0.5s' }}>
          Your notes, turned into<br />a study partner
        </div>
        <div className="flex-1 max-w-md hidden sm:block self-center">
          <div className="splash__bar"><span style={{ transform: `scaleX(${progress / 100})` }} /></div>
        </div>
        <div className="splash__counter text-6xl md:text-8xl">
          {progress}<span className="text-violet-300 text-3xl md:text-5xl align-top ml-1">%</span>
        </div>
      </div>

      {/* Exit panels */}
      <div className="splash__panels">
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="splash__panel" style={{ '--i': i } as React.CSSProperties} />
        ))}
      </div>
    </div>
  );
};
