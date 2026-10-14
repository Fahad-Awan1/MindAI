import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import { voiceAPI, getErrorMessage } from '../services/api';
import { Tooltip } from './Tooltip';

interface VoiceInputButtonProps {
  /** Called with the transcribed text */
  onTranscript: (text: string) => void;
  disabled?: boolean;
  className?: string;
}

const MAX_RECORDING_MS = 5 * 60 * 1000;

const pickMimeType = () => {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return candidates.find(t => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) || '';
};

/** Record from the microphone and transcribe it with Whisper on the server. */
export const VoiceInputButton: React.FC<VoiceInputButtonProps> = ({ onTranscript, disabled, className = '' }) => {
  const [state, setState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timeoutRef = useRef<number | null>(null);

  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

  const releaseMic = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
  };

  useEffect(() => () => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    releaseMic();
  }, []);

  const start = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        releaseMic();
        const type = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type });
        if (blob.size === 0) { setState('idle'); return; }
        setState('transcribing');
        try {
          const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
          const text = await voiceAPI.transcribe(blob, `recording.${ext}`);
          if (text) onTranscript(text);
          else setError("Didn't catch that - try again.");
        } catch (err) {
          setError(getErrorMessage(err, 'Transcription failed.'));
        } finally {
          setState('idle');
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setState('recording');
      timeoutRef.current = window.setTimeout(() => recorder.state === 'recording' && recorder.stop(), MAX_RECORDING_MS);
    } catch (err) {
      releaseMic();
      setError((err as Error)?.name === 'NotAllowedError' ? 'Microphone access was blocked.' : 'Could not start the microphone.');
      setState('idle');
    }
  };

  const stop = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  if (!supported) return null;

  const label = state === 'recording' ? 'Stop recording' : state === 'transcribing' ? 'Transcribing...' : 'Speak instead of typing';

  return (
    <span className={`relative inline-flex items-center gap-2 ${className}`}>
      <Tooltip content={error || label} position="top">
        <button
          type="button"
          onClick={state === 'recording' ? stop : start}
          disabled={disabled || state === 'transcribing'}
          aria-label={label}
          className={`h-9 w-9 rounded-full flex items-center justify-center transition-all disabled:opacity-50
            ${state === 'recording'
              ? 'bg-rose-500 text-white animate-pulse shadow-lg shadow-rose-500/30'
              : error ? 'bg-rose-50 text-rose-500 hover:bg-rose-100' : 'bg-slate-100 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600'}`}
        >
          {state === 'transcribing' ? <Loader2 className="w-4 h-4 animate-spin" />
            : state === 'recording' ? <Square className="w-3.5 h-3.5 fill-current" />
            : <Mic className="w-4 h-4" />}
        </button>
      </Tooltip>
      {state === 'recording' && <span className="text-xs font-bold text-rose-500 whitespace-nowrap">Listening...</span>}
    </span>
  );
};
