import React, { useEffect, useRef, useState } from 'react';
import { Volume2, Square, Loader2 } from 'lucide-react';
import { speak, stopSpeaking } from '../services/speech';
import { Tooltip } from './Tooltip';

// Only one SpeakButton plays at a time; starting another resets the previous one
let activeReset: (() => void) | null = null;

/** Read text aloud (Groq voice if enabled, otherwise the browser's voice). */
export const SpeakButton: React.FC<{ text: string; className?: string }> = ({ text, className = '' }) => {
  const [state, setState] = useState<'idle' | 'loading' | 'speaking'>('idle');
  const mounted = useRef(true);

  useEffect(() => () => {
    mounted.current = false;
    if (activeReset === reset) {
      stopSpeaking();
      activeReset = null;
    }
  }, []);

  function reset() {
    if (mounted.current) setState('idle');
  }

  const handleClick = async () => {
    if (state !== 'idle') {
      stopSpeaking();
      reset();
      activeReset = null;
      return;
    }
    activeReset?.();
    activeReset = reset;
    setState('loading');
    try {
      const playback = speak(text);
      if (mounted.current) setState('speaking');
      await playback;
    } catch (err) {
      console.error('Read aloud failed:', err);
    } finally {
      if (activeReset === reset) {
        activeReset = null;
        reset();
      }
    }
  };

  return (
    <Tooltip content={state === 'idle' ? 'Read aloud' : 'Stop reading'} position="top">
      <button
        type="button"
        onClick={handleClick}
        aria-label={state === 'idle' ? 'Read aloud' : 'Stop reading'}
        className={`p-2 rounded-md transition-all ${state === 'idle' ? 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 opacity-60 group-hover:opacity-100 hover-reveal' : 'text-indigo-600 bg-indigo-50'} ${className}`}
      >
        {state === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : state === 'speaking' ? <Square className="w-3.5 h-3.5 fill-current" />
          : <Volume2 className="w-3.5 h-3.5" />}
      </button>
    </Tooltip>
  );
};
