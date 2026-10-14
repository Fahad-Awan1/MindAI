import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ToolHero } from './ToolHero';
import { AudioOverviewData, DocumentFile, StudySet, StudySetSummary } from '../types';
import { audioAPI, studySetsAPI, getErrorMessage, VoiceStatus } from '../services/api';
import { getVoiceStatus, pickBrowserVoices, browserSpeechSupported, stopSpeaking } from '../services/speech';
import { useSelectedDocument } from '../hooks/useSelectedDocument';
import { useInitialStudySet } from '../hooks/useInitialStudySet';
import { SavedSets } from './SavedSets';
import { AlertCircle, ChevronRight, Headphones, Loader2, Pause, Play, SkipBack, SkipForward, Sparkles, Info, ArrowLeft } from 'lucide-react';

interface AudioOverviewProps {
  documents: DocumentFile[];
  initialSetId?: string | null;
  onInitialSetConsumed?: () => void;
}

const SPEEDS = [1, 1.25, 1.5];

export const AudioOverview: React.FC<AudioOverviewProps> = ({ documents, initialSetId, onInitialSetConsumed }) => {
  const [selectedDocId, setSelectedDocId] = useSelectedDocument(documents);
  const [length, setLength] = useState<'short' | 'medium'>('short');
  const [overview, setOverview] = useState<StudySet<AudioOverviewData> | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [speed, setSpeed] = useState(1);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const lineRefs = useRef<(HTMLLIElement | null)[]>([]);
  // Increments whenever browser playback is restarted/stopped, so stale onend callbacks are ignored
  const speechToken = useRef(0);
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const lines = overview?.data.lines ?? [];
  const hasStudioAudio = !!overview?.data.audio;
  const lineStarts = useMemo(() => {
    const durations = overview?.data.audio?.durations ?? [];
    const starts: number[] = [];
    durations.reduce((acc, d) => { starts.push(acc); return acc + d; }, 0);
    return starts;
  }, [overview]);

  useEffect(() => { getVoiceStatus().then(setVoiceStatus); }, []);

  // Fetch rendered studio audio with the login header and play it from a blob URL
  useEffect(() => {
    if (!overview?.data.audio) {
      setAudioUrl(null);
      return;
    }
    let url: string | null = null;
    let cancelled = false;
    audioAPI.fetchAudio(overview.id)
      .then(blob => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setAudioUrl(url);
      })
      .catch(err => setError(getErrorMessage(err, 'Could not load the studio audio.')));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [overview?.id, overview?.data.audio]);

  const stopAll = () => {
    speechToken.current++;
    if (browserSpeechSupported()) window.speechSynthesis.cancel();
    audioRef.current?.pause();
    setIsPlaying(false);
  };

  // Stop playback when leaving the screen
  useEffect(() => () => {
    speechToken.current++;
    if (browserSpeechSupported()) window.speechSynthesis.cancel();
  }, []);

  // Keep the current line in view
  useEffect(() => {
    if (isPlaying) lineRefs.current[current]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [current, isPlaying]);

  const openOverview = (set: StudySet<AudioOverviewData>) => {
    stopAll();
    setOverview(set);
    setCurrent(0);
    setError(null);
    setSelectedDocId(set.document_id);
  };

  useInitialStudySet<AudioOverviewData>(initialSetId, openOverview, setError, onInitialSetConsumed);

  const handleOpenSaved = async (summary: StudySetSummary) => {
    try {
      openOverview(await studySetsAPI.get<AudioOverviewData>(summary.id));
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to open the saved overview.'));
    }
  };

  const handleGenerate = async () => {
    if (!selectedDocId) return;
    setIsGenerating(true);
    setError(null);
    try {
      openOverview(await audioAPI.generate(selectedDocId, length));
    } catch (err) {
      setError(getErrorMessage(err, 'Failed to create the audio overview. Please try again.'));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRender = async () => {
    if (!overview) return;
    setIsRendering(true);
    setError(null);
    try {
      openOverview(await audioAPI.render(overview.id));
    } catch (err) {
      setError(getErrorMessage(err, 'Studio audio is not available yet.'));
    } finally {
      setIsRendering(false);
    }
  };

  /** Browser voices: speak lines one after another, alternating host voices. */
  const speakFrom = (index: number) => {
    const token = ++speechToken.current;
    window.speechSynthesis.cancel();
    const voices = pickBrowserVoices();
    const speakLine = (i: number) => {
      if (token !== speechToken.current) return;
      if (i >= lines.length) {
        setIsPlaying(false);
        setCurrent(0);
        return;
      }
      setCurrent(i);
      const utterance = new SpeechSynthesisUtterance(lines[i].text);
      const voice = lines[i].speaker === 'A' ? voices[0] : (voices[1] ?? voices[0]);
      if (voice) utterance.voice = voice;
      // A slightly different pitch helps tell the hosts apart when only one voice is installed
      utterance.pitch = lines[i].speaker === 'A' ? 1 : (voices[1] ? 1 : 1.25);
      utterance.rate = speedRef.current;
      utterance.onend = () => speakLine(i + 1);
      utterance.onerror = (e) => {
        if (e.error !== 'interrupted' && e.error !== 'canceled' && token === speechToken.current) setIsPlaying(false);
      };
      window.speechSynthesis.speak(utterance);
    };
    speakLine(index);
  };

  const playFrom = (index: number) => {
    stopSpeaking();
    setCurrent(index);
    setIsPlaying(true);
    if (hasStudioAudio && audioRef.current) {
      speechToken.current++;
      audioRef.current.currentTime = lineStarts[index] ?? 0;
      audioRef.current.playbackRate = speed;
      audioRef.current.play().catch(() => setIsPlaying(false));
    } else if (browserSpeechSupported()) {
      speakFrom(index);
    } else {
      setIsPlaying(false);
      setError("Your browser can't speak text aloud. Try Chrome, Edge or Safari.");
    }
  };

  const togglePlay = () => (isPlaying ? stopAll() : playFrom(current));

  const changeSpeed = (value: number) => {
    setSpeed(value);
    speedRef.current = value;
    if (audioRef.current) audioRef.current.playbackRate = value;
    // Browser speech applies the rate per line: restart the current line at the new speed
    if (isPlaying && !hasStudioAudio) speakFrom(current);
  };

  const handleTimeUpdate = () => {
    const t = audioRef.current?.currentTime ?? 0;
    let index = 0;
    for (let i = 0; i < lineStarts.length; i++) if (lineStarts[i] <= t) index = i;
    if (index !== current) setCurrent(index);
  };

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 bg-slate-50/50">
        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6 animate-bounce-slight">
          <AlertCircle className="w-10 h-10 text-slate-300" />
        </div>
        <h3 className="text-xl font-semibold text-slate-700">Audio Overview</h3>
        <p className="text-slate-400 mt-2">Upload a document to turn it into a podcast.</p>
      </div>
    );
  }

  // Player
  if (overview) {
    return (
      <div className="max-w-3xl mx-auto p-4 md:p-10 pb-24 animate-fade-in">
        <button onClick={() => { stopAll(); setOverview(null); }} className="flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-slate-700 mb-6">
          <ArrowLeft className="w-4 h-4" /> All overviews
        </button>

        <div className="relative bg-slate-900 text-white rounded-[2rem] p-5 md:p-8 overflow-hidden shadow-2xl mb-6">
          <div className="absolute -top-20 -right-16 w-72 h-72 bg-rose-500 rounded-full blur-[90px] opacity-30" />
          <div className="absolute -bottom-24 -left-10 w-72 h-72 bg-indigo-500 rounded-full blur-[90px] opacity-25" />
          <div className="relative z-10">
            <p className="text-xs font-bold uppercase tracking-widest text-rose-300 mb-2 flex items-center gap-2">
              <Headphones className="w-4 h-4" /> Audio overview · {overview.document_title}
            </p>
            <h2 className="text-2xl md:text-3xl font-display font-bold leading-tight mb-6 break-anywhere">{overview.data.title}</h2>

            <div className="flex flex-wrap items-center gap-3 md:gap-4">
              <button onClick={() => playFrom(Math.max(current - 1, 0))} className="p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors" aria-label="Previous line">
                <SkipBack className="w-5 h-5" />
              </button>
              <button onClick={togglePlay} className="w-16 h-16 rounded-full bg-white text-slate-900 flex items-center justify-center shadow-xl hover:scale-105 active:scale-95 transition-transform" aria-label={isPlaying ? 'Pause' : 'Play'}>
                {isPlaying ? <Pause className="w-7 h-7 fill-current" /> : <Play className="w-7 h-7 fill-current ml-1" />}
              </button>
              <button onClick={() => playFrom(Math.min(current + 1, lines.length - 1))} className="p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors" aria-label="Next line">
                <SkipForward className="w-5 h-5" />
              </button>
              <div className="w-full sm:w-auto sm:ml-auto flex items-center justify-center gap-1 bg-white/10 rounded-full p-1" role="group" aria-label="Playback speed">
                {SPEEDS.map(s => (
                  <button key={s} onClick={() => changeSpeed(s)} className={`flex-1 sm:flex-none px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${speed === s ? 'bg-white text-slate-900' : 'text-white/70 hover:text-white'}`}>
                    {s}x
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-5 h-1.5 bg-white/15 rounded-full overflow-hidden" role="progressbar" aria-valuemin={1} aria-valuemax={lines.length} aria-valuenow={current + 1}>
              <div className="h-full bg-rose-400 rounded-full transition-all duration-500" style={{ width: `${((current + 1) / Math.max(lines.length, 1)) * 100}%` }} />
            </div>
            <p className="text-xs text-white/50 mt-2">Line {current + 1} of {lines.length}</p>
          </div>
        </div>

        {/* Voice source notice */}
        {!hasStudioAudio && (
          <div className="flex items-start gap-3 p-4 mb-6 rounded-2xl bg-amber-50 border border-amber-100 text-sm text-amber-900">
            <Info className="w-5 h-5 flex-shrink-0 mt-0.5 text-amber-500" />
            <div className="flex-1">
              {voiceStatus?.tts_available ? (
                <>
                  <p>Playing with your browser's voices. Studio voices are available for this overview.</p>
                  <button onClick={handleRender} disabled={isRendering} className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500 text-white font-bold text-xs disabled:opacity-60">
                    {isRendering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Generate studio audio
                  </button>
                </>
              ) : (
                <p>Playing with your browser's built-in voices. {voiceStatus?.tts_reason ?? ''}</p>
              )}
            </div>
          </div>
        )}
        {error && <p className="mb-6 text-sm text-red-600 bg-red-50 rounded-xl p-3">{error}</p>}

        {hasStudioAudio && audioUrl && (
          <audio
            ref={audioRef}
            src={audioUrl}
            preload="auto"
            onTimeUpdate={handleTimeUpdate}
            onEnded={() => { setIsPlaying(false); setCurrent(0); }}
            onPause={() => setIsPlaying(false)}
            onPlay={() => setIsPlaying(true)}
          />
        )}

        {/* Transcript */}
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Transcript · click a line to play from there</h3>
        <ol className="space-y-2">
          {lines.map((line, i) => (
            <li key={i} ref={el => { lineRefs.current[i] = el; }}>
              <button
                onClick={() => playFrom(i)}
                className={`w-full text-left flex gap-3 p-4 rounded-2xl transition-all ${i === current ? 'bg-white shadow-md border border-slate-100' : 'hover:bg-white/70'}`}
              >
                <span className={`w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold text-white ${line.speaker === 'A' ? 'bg-indigo-500' : 'bg-rose-500'}`}>
                  {line.name[0]}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-slate-400 mb-0.5">{line.name}</span>
                  <span className={`block leading-relaxed ${i === current ? 'text-slate-900' : 'text-slate-600'}`}>{line.text}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  // Setup
  return (
    <div className="max-w-5xl mx-auto p-4 md:p-8 pb-20 animate-fade-in">
      <div className="flex flex-col items-center text-center mt-4 md:mt-10">
        <ToolHero
          icon={Headphones}
          gradient="from-rose-400 to-fuchsia-600"
          glow="bg-rose-400"
          eyebrow="Listen & learn"
          tone="text-rose-500"
          title="Audio Overview"
          accent={['Overview']}
          subtitle="Turn any document into a short podcast. Two hosts, Alex and Sam, talk you through the key ideas, perfect for revising on the go."
        />

        <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-100 p-8 relative overflow-hidden text-left tool-card spotlight">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-rose-400 to-fuchsia-600"></div>
          <label className="block text-sm font-bold text-slate-700 mb-3 uppercase tracking-wide">Source Material</label>
          <div className="relative mb-6">
            <select
              value={selectedDocId}
              onChange={e => setSelectedDocId(e.target.value)}
              className="w-full appearance-none rounded-xl border-slate-200 bg-slate-50 py-3 px-4 text-slate-700 font-medium focus:border-rose-500 focus:ring-rose-500 focus:bg-white transition-colors"
            >
              {documents.map(doc => <option key={doc.id} value={doc.id}>{doc.title}</option>)}
            </select>
            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
              <ChevronRight className="w-5 h-5 rotate-90" />
            </div>
          </div>

          <label className="block text-sm font-bold text-slate-700 mb-3 uppercase tracking-wide">Length</label>
          <div className="grid grid-cols-2 gap-2 mb-8">
            {([['short', 'Short', '~2-3 min'], ['medium', 'Medium', '~4-5 min']] as const).map(([value, label, hint]) => (
              <button
                key={value}
                onClick={() => setLength(value)}
                className={`py-3 rounded-xl border-2 text-sm font-bold transition-all ${length === value ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-slate-100 text-slate-600 hover:border-rose-200'}`}
              >
                {label}<span className="block text-xs font-medium opacity-70">{hint}</span>
              </button>
            ))}
          </div>

          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="w-full bg-gradient-to-r from-rose-500 to-fuchsia-600 text-white py-4 rounded-xl font-semibold shadow-lg shadow-rose-500/25 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:hover:scale-100"
          >
            {isGenerating ? <><Loader2 className="w-5 h-5 animate-spin" /> Writing the episode...</> : <><Sparkles className="w-5 h-5" /> Create Audio Overview</>}
          </button>
          {error && <p className="text-red-500 mt-4 text-sm font-medium bg-red-50 p-2 rounded-lg">{error}</p>}
        </div>

        <SavedSets kind="audio_overview" documentId={selectedDocId} onOpen={handleOpenSaved} accent="text-rose-600 hover:bg-rose-50" />
      </div>
    </div>
  );
};
