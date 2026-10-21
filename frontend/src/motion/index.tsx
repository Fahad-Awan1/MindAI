import React, { useEffect, useRef, useState, useCallback } from 'react';

/** True when the user asked the OS for less motion. */
export const prefersReducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/** True on devices with a precise pointer that can hover (custom cursor, magnetic effects). */
export const hasFinePointer = (): boolean => {
  try {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  } catch {
    return false;
  }
};

/**
 * Marks an element as "in view" once it scrolls into its scroll container's viewport.
 * Fires once by default, which is what reveal animations want.
 */
export function useInView<T extends Element>(options: { once?: boolean; threshold?: number; rootMargin?: string } = {}) {
  const { once = true, threshold = 0.15, rootMargin = '0px 0px -8% 0px' } = options;
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined' || prefersReducedMotion()) {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { threshold, rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [once, threshold, rootMargin]);

  return [ref, inView] as const;
}

type RevealTextTag = 'h1' | 'h2' | 'h3' | 'p' | 'span' | 'div';

interface RevealTextProps {
  /** Plain text; words are split and revealed one by one from behind a mask */
  text: string;
  as?: RevealTextTag;
  className?: string;
  /** Delay before the first word, in ms */
  delay?: number;
  /** Optional words (exact match, case-insensitive) rendered with accentClassName */
  accent?: string[];
  accentClassName?: string;
}

/** Headline that rises word by word from behind a mask when it scrolls into view. */
export const RevealText: React.FC<RevealTextProps> = ({
  text, as = 'h1', className = '', delay = 0, accent = [], accentClassName = 'font-elegant italic font-normal text-gradient-anim',
}) => {
  const [ref, inView] = useInView<HTMLElement>();
  const Tag = as as React.ElementType;
  const accentSet = new Set(accent.map(a => a.toLowerCase()));
  const words = text.split(' ');
  return (
    <Tag ref={ref} className={`${className} ${inView ? 'is-in' : ''}`} aria-label={text}>
      {words.map((word, i) => (
        <React.Fragment key={i}>
          <span className="rv-mask" aria-hidden="true">
            <span
              className={`rv-word ${accentSet.has(word.replace(/[^\w'-]/g, '').toLowerCase()) ? accentClassName : ''}`}
              style={{ '--i': i, '--d': `${delay}ms` } as React.CSSProperties}
            >
              {word}
            </span>
          </span>
          {i < words.length - 1 ? ' ' : null}
        </React.Fragment>
      ))}
    </Tag>
  );
};

/**
 * Text whose characters roll up on hover (each character is duplicated below itself).
 * Hover is triggered by the nearest ancestor with class "roll-host" or by the text itself.
 */
// The roll plays on hover, which touch screens don't have: there the label stays plain text
// (two elements per letter add up: the menu alone had ~600 of them, all costing style and layout work)
const CAN_HOVER = (() => {
  try {
    return window.matchMedia('(hover: hover)').matches;
  } catch {
    return true;
  }
})();

export const RollText: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => (
  !CAN_HOVER ? <span className={className}>{text}</span> :
  <span className={`roll ${className}`} aria-label={text}>
    {Array.from(text).map((ch, i) => (
      <span className="roll-c" key={i} aria-hidden="true">
        <span data-c={ch === ' ' ? ' ' : ch} style={{ '--i': i } as React.CSSProperties}>
          {ch === ' ' ? ' ' : ch}
        </span>
      </span>
    ))}
  </span>
);

interface RevealProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  variant?: 'up' | 'left' | 'scale' | 'blur';
  as?: 'div' | 'section' | 'li';
}

/** Block that fades and rises into place when scrolled into view. */
export const Reveal: React.FC<RevealProps> = ({ children, className = '', delay = 0, variant = 'up', as = 'div' }) => {
  const [ref, inView] = useInView<HTMLElement>();
  const Tag = as as React.ElementType;
  const variantClass = variant === 'left' ? 'reveal-left' : variant === 'scale' ? 'reveal-scale' : variant === 'blur' ? 'reveal-blur' : '';
  return (
    <Tag ref={ref} className={`reveal ${variantClass} ${inView ? 'is-in' : ''} ${className}`} style={{ '--d': `${delay}ms` } as React.CSSProperties}>
      {children}
    </Tag>
  );
};

/** Animated number that counts up when it first appears. */
export const CountUp: React.FC<{ value: number; duration?: number; suffix?: string; className?: string; decimals?: number }> = ({
  value, duration = 1400, suffix = '', className = '', decimals = 0,
}) => {
  const [ref, inView] = useInView<HTMLSpanElement>();
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (prefersReducedMotion()) {
      setDisplay(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 4);
      setDisplay(from + (value - from) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, value, duration]);

  return (
    <span ref={ref} className={className}>
      {display.toFixed(decimals)}
      {suffix}
    </span>
  );
};

/** Infinite horizontal ticker that pauses on hover. */
export const Marquee: React.FC<{ children: React.ReactNode; duration?: number; reverse?: boolean; className?: string }> = ({
  children, duration = 40, reverse = false, className = '',
}) => (
  <div className={`marquee ${className}`}>
    <div className={`marquee__track ${reverse ? 'reverse' : ''}`} style={{ '--marquee-duration': `${duration}s` } as React.CSSProperties}>
      <div className="flex shrink-0 items-center">{children}</div>
      <div className="flex shrink-0 items-center" aria-hidden="true">{children}</div>
    </div>
  </div>
);

/** Wrapper that gently pulls its content toward the pointer. */
export const Magnetic: React.FC<{ children: React.ReactNode; strength?: number; className?: string }> = ({
  children, strength = 0.35, className = '',
}) => {
  const ref = useRef<HTMLSpanElement>(null);
  const enabled = useRef(false);

  useEffect(() => {
    enabled.current = hasFinePointer() && !prefersReducedMotion();
  }, []);

  const onMove = useCallback((e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || !enabled.current) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left - rect.width / 2) * strength;
    const y = (e.clientY - rect.top - rect.height / 2) * strength;
    el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }, [strength]);

  const onLeave = useCallback(() => {
    if (ref.current) ref.current.style.transform = '';
  }, []);

  return (
    <span ref={ref} className={`magnetic inline-flex ${className}`} onPointerMove={onMove} onPointerLeave={onLeave}>
      {children}
    </span>
  );
};

/** Tilts a card in 3D following the pointer. Returns handlers to spread on the element. */
export function useTilt(max = 6) {
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!hasFinePointer() || prefersReducedMotion()) return;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.setProperty('--rx', `${(-py * max).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${(px * max).toFixed(2)}deg`);
  }, [max]);
  const onPointerLeave = useCallback((e: React.PointerEvent<HTMLElement>) => {
    e.currentTarget.style.setProperty('--rx', '0deg');
    e.currentTarget.style.setProperty('--ry', '0deg');
  }, []);
  return { onPointerMove, onPointerLeave };
}

/**
 * One global listener that feeds the pointer position into every `.spotlight` card
 * (as --mx / --my), so cards light up under the cursor without per-card handlers.
 */
export function useGlobalSpotlight() {
  useEffect(() => {
    if (!hasFinePointer()) return;
    let frame = 0;
    let last: PointerEvent | null = null;
    const update = () => {
      frame = 0;
      if (!last) return;
      const target = (last.target as Element | null)?.closest?.('.spotlight') as HTMLElement | null;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      target.style.setProperty('--mx', `${last.clientX - rect.left}px`);
      target.style.setProperty('--my', `${last.clientY - rect.top}px`);
    };
    const onMove = (e: PointerEvent) => {
      last = e;
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  /** Words of the title shown in the italic serif accent */
  accent?: string[];
  subtitle?: React.ReactNode;
  /** Tailwind text colour class for the eyebrow, e.g. "text-violet-600" */
  tone?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  center?: boolean;
}

/** Shared animated header for every tool screen: eyebrow, masked headline reveal, subtitle. */
export const PageHeader: React.FC<PageHeaderProps> = ({
  eyebrow, title, accent = [], subtitle, tone = 'text-primary-600', icon, actions, className = '', center = false,
}) => (
  <header className={`relative ${center ? 'text-center flex flex-col items-center' : ''} ${className}`}>
    <div className={`flex ${center ? 'flex-col items-center' : 'flex-col md:flex-row md:items-end md:justify-between'} gap-4`}>
      <div className={center ? 'flex flex-col items-center' : ''}>
        <Reveal delay={0} className={`flex items-center gap-3 mb-3 ${center ? 'justify-center' : ''}`}>
          {icon && <span className="inline-flex items-center justify-center w-9 h-9 rounded-xl bg-white shadow-sm ring-1 ring-slate-200/70">{icon}</span>}
          <span className={`page-eyebrow ${tone}`}>{eyebrow}</span>
        </Reveal>
        <RevealText
          text={title}
          accent={accent}
          as="h1"
          delay={80}
          className="font-display font-bold text-slate-900 tracking-tight leading-[1.05] text-[2.1rem] md:text-5xl"
        />
        {subtitle && (
          <Reveal delay={260} className={`mt-3 text-slate-500 text-base md:text-lg max-w-2xl ${center ? 'mx-auto' : ''}`}>
            {subtitle}
          </Reveal>
        )}
      </div>
      {actions && <Reveal delay={300} className="flex-shrink-0">{actions}</Reveal>}
    </div>
  </header>
);
