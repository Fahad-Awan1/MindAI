import React, { useEffect, useRef, useState } from 'react';
import { DocumentFile, DocumentSegment, ReaderFocus, StudySetSummary } from '../types';
import { documentsAPI, tutorAPI, getErrorMessage } from '../services/api';
import { useSelectedDocument } from '../hooks/useSelectedDocument';
import { TutorChat } from './TutorChat';
import { AlertCircle, BookOpen, ChevronRight, Loader2, Lightbulb, Wand2, Layers, GraduationCap, X, Highlighter } from 'lucide-react';
import { PageHeader } from '../motion';

interface ReaderProps {
  documents: DocumentFile[];
  /** Passage to scroll to and highlight (e.g. a cited source) */
  focus?: ReaderFocus | null;
  onFocusConsumed?: () => void;
  onOpenSet: (set: StudySetSummary) => void;
}

interface Highlight {
  segment: number;
  start: number;
  end: number;
}

interface SelectionState {
  text: string;
  top: number;
  left: number;
}

const MAX_SELECTION = 4000;
const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Text with whitespace runs collapsed, plus a map from each collapsed index to the original index. */
const collapseWithMap = (text: string) => {
  let flat = '';
  const map: number[] = [];
  let lastWasSpace = true;
  for (let i = 0; i < text.length; i++) {
    const isSpace = /\s/.test(text[i]);
    if (isSpace && lastWasSpace) continue;
    flat += isSpace ? ' ' : text[i];
    map.push(i);
    lastWasSpace = isSpace;
  }
  return { flat, map };
};

/** Inline **bold** / *italic* / `code` without the Markdown markers. */
const renderInline = (line: string): React.ReactNode[] =>
  line.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g).map((part, k) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={k}>{part.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(part)) return <code key={k} className="font-mono text-[0.9em] bg-slate-100 rounded px-1">{part.slice(1, -1)}</code>;
    if (/^\*[^*\s][^*]*\*$/.test(part)) return <em key={k}>{part.slice(1, -1)}</em>;
    return part;
  });

/** Light Markdown (headings, bullets, emphasis) so .md notes don't show their # and ** markers. */
const renderMarkdownLite = (text: string) =>
  text.split('\n').map((line, k) => {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const size = heading[1].length <= 1 ? 'text-2xl' : heading[1].length === 2 ? 'text-xl' : 'text-lg';
      return <span key={k} className={`block font-sans font-bold text-slate-900 ${size} mt-4 mb-1`}>{renderInline(heading[2])}</span>;
    }
    const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
    if (bullet) return <span key={k} className="block pl-5 -indent-4" style={{ marginLeft: `${bullet[1].length * 0.5}rem` }}>{'• '}{renderInline(bullet[2])}</span>;
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) return <hr key={k} className="my-4 border-slate-200" />;
    return <span key={k} className="block min-h-[1em]">{renderInline(line)}</span>;
  });

/** Locate a passage inside the segments, tolerating whitespace differences. */
const findPassage = (segments: DocumentSegment[], passage: string): Highlight | null => {
  const target = squash(passage);
  if (!target) return null;
  // Try the whole passage first, then its opening words (chunks can start mid-sentence)
  for (const probe of [target, target.slice(0, 80)]) {
    for (const seg of segments) {
      const { flat, map } = collapseWithMap(seg.text);
      const at = flat.indexOf(probe);
      if (at !== -1) {
        const endFlat = Math.min(at + target.length, map.length) - 1;
        return { segment: seg.index, start: map[at], end: map[endFlat] + 1 };
      }
    }
  }
  return null;
};

export const Reader: React.FC<ReaderProps> = ({ documents, focus, onFocusConsumed, onOpenSet }) => {
  const [docId, setDocId] = useSelectedDocument(documents, focus?.documentId);
  const [segments, setSegments] = useState<DocumentSegment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [panel, setPanel] = useState<{ action: 'explain' | 'simplify'; text: string } | null>(null);
  const [busy, setBusy] = useState<'flashcards' | 'quiz' | null>(null);
  const [toast, setToast] = useState<{ message: string; set?: StudySetSummary; isError?: boolean } | null>(null);
  const articleRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<ReaderFocus | null>(focus ?? null);

  // A new focus request (e.g. clicking another citation while the reader is open)
  useEffect(() => {
    if (focus) {
      pendingFocus.current = focus;
      if (focus.documentId !== docId) setDocId(focus.documentId);
      else if (segments.length) applyFocus(segments);
      onFocusConsumed?.();
    }
  }, [focus]);

  const applyFocus = (segs: DocumentSegment[]) => {
    const target = pendingFocus.current;
    if (!target || target.documentId !== docId) return;
    pendingFocus.current = null;
    const found = findPassage(segs, target.text);
    setHighlight(found);
    if (found) {
      requestAnimationFrame(() => {
        document.getElementById(`reader-mark`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    }
  };

  // Load the selected document's text
  useEffect(() => {
    if (!docId) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setSegments([]);
    setHighlight(null);
    setSelection(null);
    documentsAPI.getSegments(docId)
      .then(segs => {
        if (cancelled) return;
        setSegments(segs);
        applyFocus(segs);
      })
      .catch(err => { if (!cancelled) setError(getErrorMessage(err, 'Failed to load the document.')); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [docId]);

  // Touch screens: long-press / drag-handle selection fires no mouseup, so follow the selection itself
  const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  useEffect(() => {
    if (!touch) return;
    let timer: number | undefined;
    const onChange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => readSelection(), 350);
    };
    document.addEventListener('selectionchange', onChange);
    return () => { window.clearTimeout(timer); document.removeEventListener('selectionchange', onChange); };
  }, [touch, segments.length]);

  // Hide the floating selection toolbar when scrolling (its position would be stale; on touch it's docked)
  useEffect(() => {
    if (touch) return;
    const container = articleRef.current?.closest('.overflow-y-auto');
    const hide = () => setSelection(null);
    container?.addEventListener('scroll', hide, { passive: true });
    return () => container?.removeEventListener('scroll', hide);
  }, [touch, segments.length]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const readSelection = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? '';
    if (!sel || sel.rangeCount === 0 || text.length < 3 || !articleRef.current?.contains(sel.anchorNode)) {
      setSelection(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    setSelection({
      text: text.slice(0, MAX_SELECTION),
      top: Math.max(rect.top - 12, 72),
      left: Math.min(Math.max(rect.left + rect.width / 2, 180), window.innerWidth - 180),
    });
  };

  const runAction = async (action: 'explain' | 'simplify' | 'flashcards' | 'quiz') => {
    if (!selection) return;
    const text = selection.text;
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    if (action === 'explain' || action === 'simplify') {
      setPanel({ action, text });
      return;
    }
    setBusy(action);
    try {
      if (action === 'flashcards') {
        const deck = await tutorAPI.selectionFlashcards(docId, text);
        const added = Number(deck.config.added ?? 1);
        setToast({ message: `Added ${added} card${added === 1 ? '' : 's'} to "${deck.title}"`, set: deck });
      } else {
        onOpenSet(await tutorAPI.selectionQuiz(docId, text));
      }
    } catch (err) {
      setToast({ message: getErrorMessage(err, 'Something went wrong. Please try again.'), isError: true });
    } finally {
      setBusy(null);
    }
  };

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-slate-500 bg-slate-50/50">
        <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6 animate-bounce-slight">
          <AlertCircle className="w-10 h-10 text-slate-300" />
        </div>
        <h3 className="text-xl font-semibold text-slate-700">Reader</h3>
        <p className="text-slate-400 mt-2">Upload a document to read it here.</p>
      </div>
    );
  }

  const renderText = (seg: DocumentSegment) => {
    // A highlight is placed by character offsets in the raw text, so that segment stays raw
    if (!highlight || highlight.segment !== seg.index) return renderMarkdownLite(seg.text);
    return (
      <>
        {seg.text.slice(0, highlight.start)}
        <mark id="reader-mark" className="bg-amber-200/70 text-inherit rounded px-0.5 scroll-mt-32 animate-pulse-slow">{seg.text.slice(highlight.start, highlight.end)}</mark>
        {seg.text.slice(highlight.end)}
      </>
    );
  };

  const currentDoc = documents.find(d => d.id === docId);

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-10 pb-24">
      {/* Header */}
      <PageHeader
        className="mb-8"
        icon={<BookOpen className="w-5 h-5 text-slate-700" />}
        eyebrow="Read & highlight"
        tone="text-slate-600"
        title="The Reader"
        accent={['Reader']}
        subtitle={<span className="flex items-center gap-1.5 text-base"><Highlighter className="w-4 h-4 flex-shrink-0" /> Highlight any text to explain it, simplify it, or turn it into flashcards and quizzes.</span>}
        actions={
        <div className="relative">
          <select
            value={docId}
            onChange={e => setDocId(e.target.value)}
            className="appearance-none w-full md:w-72 rounded-xl border-slate-200 bg-white py-2.5 pl-4 pr-10 text-slate-700 font-medium shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            aria-label="Document"
          >
            {documents.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
          <ChevronRight className="w-4 h-4 rotate-90 absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
        }
      />

      {/* Document */}
      <article
        ref={articleRef}
        onMouseUp={readSelection}
        key={docId}
        className="bg-white rounded-3xl border border-slate-100 shadow-sm px-6 md:px-12 py-10 font-serif text-[17px] leading-8 text-slate-800 selection:bg-indigo-100 animate-rise"
        style={{ animationDelay: '250ms', animationFillMode: 'backwards' }}
      >
        <h2 className="font-sans text-2xl font-bold text-slate-900 mb-8 pb-4 border-b border-slate-100">{currentDoc?.title}</h2>
        {isLoading && (
          <div className="flex items-center justify-center py-20 text-slate-400 font-sans">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}
        {error && <p className="font-sans text-sm text-red-600 bg-red-50 rounded-xl p-3">{error}</p>}
        {!isLoading && !error && segments.length === 0 && (
          <p className="font-sans text-slate-400 text-center py-12">No text could be extracted from this document.</p>
        )}
        {segments.map(seg => (
          <section key={seg.index} className="mb-8 last:mb-0">
            {seg.label && (
              <h3 className="font-sans text-xs font-bold uppercase tracking-widest text-indigo-500 mb-3">{seg.label}</h3>
            )}
            <div className="whitespace-pre-wrap">{renderText(seg)}</div>
          </section>
        ))}
      </article>

      {/* Selection toolbar */}
      {selection && (
        <div
          className={touch
            ? 'fixed z-40 inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-6 grid grid-cols-2 gap-1 p-1.5 rounded-2xl bg-slate-900 text-white shadow-2xl animate-slide-up font-sans'
            : 'fixed z-40 -translate-x-1/2 -translate-y-full flex items-center gap-1 p-1.5 rounded-xl bg-slate-900 text-white shadow-2xl animate-scale-in font-sans'}
          style={touch ? undefined : { top: selection.top, left: selection.left }}
          onMouseDown={e => e.preventDefault()}
          role="toolbar"
          aria-label="Selection actions"
        >
          {[
            { action: 'explain' as const, label: 'Explain', icon: Lightbulb },
            { action: 'simplify' as const, label: 'Simplify', icon: Wand2 },
            { action: 'flashcards' as const, label: 'Make flashcard', icon: Layers },
            { action: 'quiz' as const, label: 'Quiz me', icon: GraduationCap },
          ].map(({ action, label, icon: Icon }) => (
            <button
              key={action}
              onClick={() => runAction(action)}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-semibold hover:bg-white/15 active:bg-white/20 transition-colors whitespace-nowrap"
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>
      )}

      {/* Working indicator / toast */}
      {(busy || toast) && (
        <div className={`fixed bottom-24 md:bottom-6 inset-x-4 mx-auto w-fit max-w-[calc(100vw-2rem)] z-40 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl font-sans text-sm animate-slide-up
          ${toast?.isError ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'}`} role="status">
          {busy ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> {busy === 'quiz' ? 'Writing your quiz...' : 'Making flashcards...'}</>
          ) : toast && (
            <>
              <span>{toast.message}</span>
              {toast.set && (
                <button onClick={() => onOpenSet(toast.set!)} className="font-bold text-amber-300 hover:text-amber-200 whitespace-nowrap">Review deck</button>
              )}
              <button onClick={() => setToast(null)} className="text-white/60 hover:text-white" aria-label="Dismiss"><X className="w-4 h-4" /></button>
            </>
          )}
        </div>
      )}

      {panel && (
        <TutorChat
          title={panel.action === 'explain' ? 'Explain this' : 'Simplify this'}
          subtitle={currentDoc?.title ?? ''}
          icon={panel.action === 'explain' ? <Lightbulb className="w-5 h-5" /> : <Wand2 className="w-5 h-5" />}
          onClose={() => setPanel(null)}
          request={(history, followUp, options) => tutorAPI.selection({
            document_id: docId,
            selection: panel.text,
            action: panel.action,
            history,
            message: followUp,
          }, options)}
          context={
            <blockquote className="bg-white rounded-2xl border border-slate-100 border-l-4 border-l-amber-300 p-4 text-sm text-slate-600 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto font-serif">
              {panel.text}
            </blockquote>
          }
        />
      )}
    </div>
  );
};
