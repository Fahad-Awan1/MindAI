import React, { useMemo } from 'react';
import { prefersReducedMotion } from '../motion';

const COLORS = ['#7c3aed', '#4f46e5', '#f59e0b', '#ec4899', '#10b981', '#38bdf8'];

/** A one-shot confetti burst that falls over its (relative) parent. Decorative only. */
export const Confetti: React.FC<{ pieces?: number }> = ({ pieces = 60 }) => {
  const bits = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        duration: 1.8 + Math.random() * 1.6,
        drift: (Math.random() - 0.5) * 160,
        spin: (Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 540),
        size: 6 + Math.random() * 6,
        color: COLORS[i % COLORS.length],
        round: Math.random() > 0.6,
      })),
    [pieces],
  );

  if (prefersReducedMotion()) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden no-print" aria-hidden="true">
      {bits.map((b, i) => (
        <span
          key={i}
          className="confetti-bit"
          style={{
            left: `${b.left}%`,
            width: b.size,
            height: b.round ? b.size : b.size * 0.45,
            background: b.color,
            borderRadius: b.round ? '999px' : '2px',
            animationDelay: `${b.delay}s`,
            animationDuration: `${b.duration}s`,
            '--drift': `${b.drift}px`,
            '--spin': `${b.spin}deg`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
};
