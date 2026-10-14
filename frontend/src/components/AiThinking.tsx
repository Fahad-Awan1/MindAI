import React, { useEffect, useState } from 'react';
import { LogoMark } from './Logo';

interface AiThinkingProps {
  title: string;
  subtitle: string;
  /** Hex colour for the orbit and glow */
  color: string;
  /** Short progress lines cycled under the title */
  steps?: string[];
}

const DEFAULT_STEPS = ['Reading your document', 'Finding the key ideas', 'Writing it up for you'];

/** Generating state for AI tools: the logo with orbiting particles, pulsing glow and cycling steps. */
export const AiThinking: React.FC<AiThinkingProps> = ({ title, subtitle, color, steps = DEFAULT_STEPS }) => {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setStep(s => (s + 1) % steps.length), 2200);
    return () => window.clearInterval(id);
  }, [steps.length]);

  return (
    <div className="flex flex-col items-center justify-center mt-16 text-center animate-rise" role="status" aria-live="polite">
      <div className="relative w-36 h-36 flex items-center justify-center">
        <div className="absolute inset-4 rounded-full blur-2xl opacity-40 animate-pulse-slow" style={{ background: color }} />
        <div className="absolute inset-0 rounded-full border border-dashed opacity-40 animate-spin-slow" style={{ borderColor: color }} />
        <div className="absolute inset-3 rounded-full border opacity-20" style={{ borderColor: color }} />
        {[0, 1, 2].map(i => (
          <div key={i} className="absolute inset-0 animate-spin" style={{ animationDuration: `${2.4 + i * 0.9}s`, animationDirection: i === 1 ? 'reverse' : 'normal' }}>
            <span
              className="absolute left-1/2 -translate-x-1/2 rounded-full shadow-lg"
              style={{ top: `${i * 10}px`, width: 10 - i * 2, height: 10 - i * 2, background: i === 2 ? '#fbbf24' : color }}
            />
          </div>
        ))}
        <LogoMark size={56} className="relative animate-float drop-shadow-xl" />
      </div>
      <h3 className="text-2xl font-display font-bold text-slate-900 mt-6">{title}</h3>
      <p className="text-slate-500 mt-2 max-w-sm">{subtitle}</p>
      <div className="mt-5 h-6 overflow-hidden">
        <p key={step} className="text-sm font-semibold animate-rise flex items-center gap-2" style={{ color }}>
          <span className="typing-dots"><span></span><span></span><span></span></span>
          {steps[step]}
        </p>
      </div>
    </div>
  );
};
