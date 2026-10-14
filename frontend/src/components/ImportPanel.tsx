import React, { useEffect, useRef, useState } from 'react';
import { ImportJob } from '../types';
import { importsAPI, getErrorMessage, API_BASE_URL } from '../services/api';
import { Reveal } from '../motion';
import { Mic, Link2, Loader2, CheckCircle2, AlertCircle, X, Youtube, Globe, FileAudio, Upload, ArrowRight } from 'lucide-react';

interface ImportPanelProps {
  /** Called when an import finishes so the library can refresh */
  onImported: (documentId: string) => void;
  onOpenDocument: (documentId: string) => void;
  /** Bumped by the parent after it starts an import itself (e.g. a recording dropped on the main upload zone) */
  refreshKey?: number;
}

export const MEDIA_EXTENSIONS = ['.mp3', '.m4a', '.wav', '.ogg', '.oga', '.opus', '.flac', '.aac', '.webm', '.mp4', '.mov', '.mkv', '.m4v', '.avi', '.mpeg', '.mpga'];
export const isMediaFile = (name: string) => MEDIA_EXTENSIONS.some(ext => name.toLowerCase().endsWith(ext));

const MB = 1024 * 1024;
/**
 * Largest recording that can be sent. The server accepts 500 MB, but when the app talks to it through a
 * public proxy / tunnel (VITE_API_URL set, e.g. Cloudflare) uploads over ~100 MB are cut off with an HTML error.
 */
export const MAX_RECORDING_BYTES = API_BASE_URL ? 95 * MB : 500 * MB;

/** A clear message when a recording is too big to upload, otherwise null. */
export const recordingTooLarge = (file: File): string | null =>
  file.size > MAX_RECORDING_BYTES
    ? `"${file.name}" is ${Math.round(file.size / MB)} MB - the limit here is ${Math.round(MAX_RECORDING_BYTES / MB)} MB. Trim or compress the recording (an audio-only file is much smaller).`
    : null;

const POLL_MS = 2000;

const kindIcon = (job: ImportJob) => (job.kind === 'youtube' ? Youtube : job.kind === 'web' ? Globe : FileAudio);

export const ImportPanel: React.FC<ImportPanelProps> = ({ onImported, onOpenDocument, refreshKey = 0 }) => {
  const [mode, setMode] = useState<'recording' | 'link'>('recording');
  const [url, setUrl] = useState('');
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const reported = useRef<Set<string>>(new Set());

  const load = () => importsAPI.list().then(list => {
    // Jobs already finished on first load don't trigger a library refresh
    list.filter(j => j.status === 'done').forEach(j => reported.current.add(j.id));
    setJobs(list);
  }).catch(() => {});

  useEffect(() => { load(); }, [refreshKey]);

  // Poll while any import is in progress
  const active = jobs.some(j => j.status === 'queued' || j.status === 'running');
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(async () => {
      try {
        const list = await importsAPI.list();
        setJobs(list);
        list.forEach(j => {
          if (j.status === 'done' && j.document_id && !reported.current.has(j.id)) {
            reported.current.add(j.id);
            onImported(j.document_id);
          }
        });
      } catch { /* try again next tick */ }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, onImported]);

  const startFiles = async (files: FileList | File[]) => {
    const media = Array.from(files).filter(f => isMediaFile(f.name));
    if (!media.length) {
      setError('Choose an audio or video recording (MP3, M4A, WAV, MP4, WEBM, MOV...).');
      return;
    }
    const tooLarge = media.map(recordingTooLarge).find(Boolean);
    if (tooLarge) {
      setError(tooLarge);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (const file of media) {
        const job = await importsAPI.uploadMedia(file);
        setJobs(prev => [job, ...prev]);
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Upload failed. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const startUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const job = await importsAPI.importUrl(url.trim());
      setJobs(prev => [job, ...prev]);
      setUrl('');
    } catch (err) {
      setError(getErrorMessage(err, 'Could not import that link.'));
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async (job: ImportJob) => {
    try {
      await importsAPI.dismiss(job.id);
      setJobs(prev => prev.filter(j => j.id !== job.id));
    } catch { /* still running */ }
  };

  return (
    <Reveal delay={300} as="section" className="mb-12">
    <div className="spotlight relative overflow-hidden bg-white/90 backdrop-blur rounded-[2rem] border border-slate-100 shadow-sm p-6 md:p-8" role="region" aria-label="Import a lecture or link">
      <div className="absolute -top-24 -right-24 w-64 h-64 rounded-full bg-gradient-to-br from-rose-100 to-orange-50 opacity-70 pointer-events-none"></div>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
        <div>
          <span className="page-eyebrow text-rose-500 mb-1">New · Lecture to notes</span>
          <h2 className="text-2xl font-display font-bold text-slate-900 tracking-tight">Turn lectures into <span className="font-elegant italic font-normal text-rose-500 text-[1.15em]">notes</span></h2>
          <p className="text-sm text-slate-500">Turn a lecture recording, YouTube video or web article into study notes you can chat with and quiz on.</p>
        </div>
        <div className="relative grid grid-cols-2 bg-slate-100 rounded-xl p-1 self-start" role="tablist">
          <span
            className="absolute top-1 bottom-1 left-1 w-[calc(50%-0.25rem)] rounded-lg bg-white shadow-sm transition-transform duration-500 ease-out-expo"
            style={{ transform: mode === 'link' ? 'translateX(100%)' : 'translateX(0)' }}
            aria-hidden="true"
          />
          {([['recording', 'Recording', Mic], ['link', 'Link', Link2]] as const).map(([value, label, Icon]) => (
            <button
              key={value}
              role="tab"
              aria-selected={mode === value}
              onClick={() => { setMode(value); setError(null); }}
              className={`relative z-10 flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors duration-300 ${mode === value ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'recording' ? (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); startFiles(e.dataTransfer.files); }}
          onClick={() => fileInput.current?.click()}
          data-cursor="Choose file"
          className={`group relative flex flex-col sm:flex-row items-center gap-4 p-5 rounded-2xl border-2 border-dashed cursor-pointer transition-all duration-500 animate-fade-in
            ${dragging ? 'border-rose-400 bg-rose-50 scale-[1.01]' : 'border-slate-200 hover:border-rose-300 hover:bg-rose-50/40'}`}
        >
          <input ref={fileInput} type="file" multiple accept={MEDIA_EXTENSIONS.join(',') + ',audio/*,video/*'} className="hidden"
            onChange={e => { if (e.target.files?.length) startFiles(e.target.files); e.target.value = ''; }} />
          <div className="w-12 h-12 rounded-2xl bg-rose-100 text-rose-600 flex items-center justify-center flex-shrink-0 transition-transform duration-700 ease-out-expo group-hover:scale-110 group-hover:-rotate-12">
            {busy ? <Loader2 className="w-6 h-6 animate-spin" /> : <Upload className="w-6 h-6" />}
          </div>
          <div className="text-center sm:text-left">
            <p className="font-semibold text-slate-800">{busy ? 'Uploading...' : 'Drop a lecture recording or click to choose'}</p>
            <p className="text-xs text-slate-400">Audio or video up to {Math.round(MAX_RECORDING_BYTES / (1024 * 1024))} MB: MP3, M4A, WAV, MP4, WEBM, MOV. Transcribed with Whisper.</p>
          </div>
        </div>
      ) : (
        <form onSubmit={startUrl} className="relative flex flex-col sm:flex-row gap-2 animate-fade-in">
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            type="url"
            placeholder="Paste a YouTube video or article link"
            className="flex-1 min-w-0 rounded-xl border-slate-200 bg-slate-50 py-3 px-4 focus:bg-white focus:border-rose-400 focus:ring-rose-400"
            aria-label="Link to import"
          />
          <button type="submit" disabled={busy || !url.trim()} className="btn-fill px-5 py-3 rounded-xl bg-slate-900 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-40">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Import
          </button>
        </form>
      )}
      {error && <p className="relative mt-3 text-sm text-rose-600 bg-rose-50 rounded-xl p-2.5 animate-slide-up">{error}</p>}

      {jobs.length > 0 && (
        <ul className="relative mt-5 space-y-2 stagger">
          {jobs.slice(0, 6).map(job => {
            const Icon = kindIcon(job);
            const running = job.status === 'queued' || job.status === 'running';
            return (
              <li key={job.id} className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-100">
                <Icon className={`w-5 h-5 flex-shrink-0 ${job.kind === 'youtube' ? 'text-red-500' : job.kind === 'web' ? 'text-sky-500' : 'text-rose-500'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{job.title || job.source}</p>
                  {running ? (
                    <div className="mt-1.5">
                      <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={job.progress}>
                        <div className="h-full rounded-full transition-all duration-700 ease-out-expo bg-[linear-gradient(90deg,#fb7185,#f97316,#fb7185)] bg-[length:200%_100%] animate-shimmer" style={{ width: `${Math.max(job.progress, 4)}%` }} />
                      </div>
                      <p className="text-xs text-slate-500 mt-1">{job.stage}...</p>
                    </div>
                  ) : job.status === 'failed' ? (
                    <p className="text-xs text-rose-600 flex items-center gap-1 mt-0.5"><AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {job.error}</p>
                  ) : (
                    <p className="text-xs text-emerald-600 flex items-center gap-1 mt-0.5"><CheckCircle2 className="w-3.5 h-3.5" /> Notes ready</p>
                  )}
                </div>
                {job.status === 'done' && job.document_id && (
                  <button onClick={() => onOpenDocument(job.document_id!)} className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-700 hover:border-rose-300">Open</button>
                )}
                {!running && (
                  <button onClick={() => dismiss(job)} className="p-1.5 rounded-lg text-slate-300 hover:text-slate-600" aria-label="Dismiss"><X className="w-4 h-4" /></button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
    </Reveal>
  );
};
