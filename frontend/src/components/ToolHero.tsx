import React from 'react';
import { RevealText, Reveal, useTilt } from '../motion';

interface ToolHeroProps {
  icon: React.ElementType;
  /** Tailwind gradient stops for the icon tile, e.g. "from-amber-400 to-orange-500" */
  gradient: string;
  /** Tailwind colour for the glow + orbit, e.g. "bg-amber-400" */
  glow: string;
  eyebrow: string;
  /** Tailwind text colour for the eyebrow */
  tone: string;
  title: string;
  /** Words of the title set in the italic serif accent */
  accent?: string[];
  subtitle: React.ReactNode;
  className?: string;
}

/** Animated hero for each study tool's setup screen: orbiting icon tile, masked headline, subtitle. */
export const ToolHero: React.FC<ToolHeroProps> = ({ icon: Icon, gradient, glow, eyebrow, tone, title, accent = [], subtitle, className = 'mb-10' }) => {
  const tilt = useTilt(14);
  return (
    <div className={`flex flex-col items-center text-center ${className}`}>
      <div className="relative mb-9 animate-pop" style={{ animationDelay: '80ms' }}>
        {/* Glow + orbit rings */}
        <div className={`absolute inset-0 rounded-[2rem] blur-2xl opacity-40 scale-125 animate-pulse-slow ${glow}`} />
        <div className="absolute -inset-5 rounded-full border border-dashed border-slate-300/70 animate-spin-slow" />
        <div className="absolute -inset-5 animate-spin-slow" style={{ animationDuration: '9s' }}>
          <span className={`absolute -top-1 left-1/2 w-2.5 h-2.5 rounded-full ${glow} shadow-lg`} />
        </div>
        <div
          {...tilt}
          className={`tilt relative w-24 h-24 bg-gradient-to-br ${gradient} rounded-[1.75rem] shadow-2xl flex items-center justify-center rotate-3`}
        >
          <div className="absolute inset-0 rounded-[1.75rem] bg-gradient-to-tr from-white/0 via-white/25 to-white/0" />
          <Icon className="relative w-12 h-12 text-white drop-shadow" />
        </div>
      </div>
      <Reveal delay={120}><span className={`page-eyebrow ${tone}`}>{eyebrow}</span></Reveal>
      <RevealText
        as="h2"
        text={title}
        accent={accent}
        delay={180}
        className="mt-3 text-[2.4rem] md:text-5xl font-display font-bold text-slate-900 tracking-tight leading-[1.05]"
      />
      <Reveal delay={380} className="mt-4 text-slate-500 max-w-lg text-lg leading-relaxed">
        {subtitle}
      </Reveal>
    </div>
  );
};
