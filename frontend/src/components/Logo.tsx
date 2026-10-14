import React, { useId } from 'react';

interface LogoMarkProps {
  /** Pixel size of the square mark */
  size?: number;
  className?: string;
}

/** The MindAI mark: an "M" drawn as a small neural network, with an amber spark of insight. */
export const LogoMark: React.FC<LogoMarkProps> = ({ size = 40, className = '' }) => {
  // Unique gradient id so several logos on one page don't clash
  const gradientId = `mindai-mark-${useId().replace(/:/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="MindAI logo">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#4f46e5" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${gradientId})`} />
      <path d="M17 45V20l15 15 15-15v25" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="17" cy="45" r="4.5" fill="#fff" />
      <circle cx="17" cy="20" r="4.5" fill="#fff" />
      <circle cx="47" cy="20" r="4.5" fill="#fff" />
      <circle cx="47" cy="45" r="4.5" fill="#fff" />
      <circle cx="32" cy="35" r="6" fill="#fbbf24" stroke="#fff" strokeWidth="2.5" />
    </svg>
  );
};

interface LogoProps {
  size?: number;
  /** Text colour for "Mind" (light on dark backgrounds) */
  tone?: 'dark' | 'light';
  /** Optional line under the wordmark, e.g. "Student Assistant" */
  tagline?: string;
  className?: string;
}

/** Mark + "MindAI" wordmark. */
export const Logo: React.FC<LogoProps> = ({ size = 40, tone = 'dark', tagline, className = '' }) => (
  <div className={`flex items-center gap-3 ${className}`}>
    <LogoMark size={size} className="flex-shrink-0 drop-shadow-sm" />
    <div className="leading-none">
      <span className={`font-display font-bold tracking-tight ${tone === 'light' ? 'text-white' : 'text-slate-900'}`} style={{ fontSize: size * 0.6 }}>
        Mind<span className={tone === 'light' ? 'text-primary-300' : 'bg-gradient-to-r from-primary-600 to-indigo-600 bg-clip-text text-transparent'}>AI</span>
      </span>
      {tagline && (
        <span className={`block text-xs font-medium mt-1 ${tone === 'light' ? 'text-slate-400' : 'text-slate-500'}`}>{tagline}</span>
      )}
    </div>
  </div>
);
