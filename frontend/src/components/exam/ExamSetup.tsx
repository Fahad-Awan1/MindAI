import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Clock, Files, Hourglass, Layers, Loader2, Plus, Sparkles, Square, Target, Trash2, Wand2, Award, ScrollText, X } from 'lucide-react';
import { DocumentFile, StudySet } from '../../types';
import { assessmentAPI, pastPaperAPI, getErrorMessage } from '../../services/api';
import { BlueprintSection, BloomPreset, DifficultySetting, GenerationEvent, Question } from '../../assessment/types';
import { TypeBadge } from '../quiz/bits';
import { LogoMark } from '../Logo';

const KIND_INFO: Record<BlueprintSection['kind'], { label: string; marks: number; minutesPerMark: number; tone: string }> = {
  objective: { label: 'Objective (MCQ)', marks: 1, minutesPerMark: 1.2, tone: 'bg-sky-500' },
  short: { label: 'Short answer', marks: 4, minutesPerMark: 1.8, tone: 'bg-violet-500' },
  long: { label: 'Long / essay', marks: 10, minutesPerMark: 1.8, tone: 'bg-rose-500' },
};

const PRESETS: { label: string; hint: string; sections: BlueprintSection[] }[] = [
  { label: 'Standard paper', hint: 'MCQs, short answers and one essay', sections: [
    { kind: 'objective', count: 6, marks_each: 1 }, { kind: 'short', count: 3, marks_each: 4 }, { kind: 'long', count: 2, marks_each: 10, attempt_any: 1 }] },
  { label: 'Quick test', hint: '10 MCQs + 2 short answers', sections: [
    { kind: 'objective', count: 10, marks_each: 1 }, { kind: 'short', count: 2, marks_each: 3 }] },
  { label: 'Essay paper', hint: 'Structured long questions with parts', sections: [
    { kind: 'long', count: 3, marks_each: 15, attempt_any: 2, subparts: true }] },
  { label: 'Short answers', hint: 'Six short-answer questions', sections: [
    { kind: 'short', count: 6, marks_each: 5 }] },
];

const sectionMarks = (s: BlueprintSection) => s.marks_each * (s.attempt_any && s.attempt_any < s.count ? s.attempt_any : s.count);
const autoDuration = (sections: BlueprintSection[]) =>
  Math.max(10, Math.ceil(sections.reduce((m, s) => m + sectionMarks(s) * KIND_INFO[s.kind].minutesPerMark, 0) / 5) * 5);

interface ExamSetupProps {
  documents: DocumentFile[];
  primaryDocId: string;
  onPrimaryDocChange: (id: string) => void;
  onReady: (set: StudySet<unknown>) => void;
}

export const ExamSetup: React.FC<ExamSetupProps> = ({ documents, primaryDocId, onPrimaryDocChange, onReady }) => {
  const [docIds, setDocIds] = useState<string[]>(primaryDocId ? [primaryDocId] : []);
  const [sections, setSections] = useState<BlueprintSection[]>(PRESETS[0].sections);
  const [difficulty, setDifficulty] = useState<DifficultySetting>('mixed');
  const [bloom, setBloom] = useState<BloomPreset>('balanced');
  const [duration, setDuration] = useState<number | null>(null);
  const [outline, setOutline] = useState<{ label: string }[]>([]);
  const [chapters, setChapters] = useState<string[]>([]);
  const [showChapters, setShowChapters] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [built, setBuilt] = useState<Question[]>([]);
  const [total, setTotal] = useState(0);
  const [waiting, setWaiting] = useState(0);
  const [currentSection, setCurrentSection] = useState<string | null>(null);
  const [pastPaperId, setPastPaperId] = useState('');
  const [styleNotes, setStyleNotes] = useState<string | null>(null);
  const [modelledOn, setModelledOn] = useState<string | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const totalMarks = sections.reduce((m, s) => m + sectionMarks(s), 0);
  const minutes = duration ?? autoDuration(sections);
  const primary = docIds[0] || primaryDocId;

  useEffect(() => { if (primaryDocId && !docIds.length) setDocIds([primaryDocId]); }, [primaryDocId]);
  useEffect(() => {
    if (!showChapters || !primary) return;
    assessmentAPI.outline(primary).then(setOutline).catch(() => setOutline([]));
  }, [showChapters, primary]);
  useEffect(() => {
    if (waiting <= 0) return;
    const t = window.setTimeout(() => setWaiting(w => Math.max(0, w - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [waiting]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const update = (i: number, patch: Partial<BlueprintSection>) =>
    setSections(prev => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const toggleDoc = (id: string) => setDocIds(prev => {
    const next = prev.includes(id) ? prev.filter(x => x !== id) : prev.length >= 5 ? prev : [...prev, id];
    if (next.length && next[0] !== prev[0]) onPrimaryDocChange(next[0]);
    return next.length ? next : prev;
  });

  const generate = async () => {
    setError(null);
    setBuilt([]);
    setBuilding(true);
    setTotal(sections.reduce((n, s) => n + s.count, 0));
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let finished: StudySet<unknown> | null = null;
      await assessmentAPI.streamExam({
        document_ids: docIds,
        sections: sections.map(s => ({ ...s, attempt_any: s.attempt_any && s.attempt_any < s.count ? s.attempt_any : null })),
        difficulty, bloom,
        duration_minutes: duration,
        chapters: showChapters ? chapters : [],
        style_notes: styleNotes || undefined,
      }, (event: GenerationEvent) => {
        if (event.type === 'waiting') setWaiting(event.seconds);
        else if (event.type === 'section') setCurrentSection(event.section);
        else if (event.type === 'question') { setWaiting(0); setBuilt(prev => [...prev, event.question]); }
        else if (event.type === 'warning') setError(event.message);
        else if (event.type === 'done') finished = event.set;
      }, controller.signal);
      if (finished) onReady(finished);
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') setError(getErrorMessage(err, 'Failed to generate the exam. Please try again.'));
    } finally {
      setBuilding(false);
    }
  };

  if (building) {
    const groups = new Set(built.map(q => q.parent_id || q.id)).size;
    return (
      <div className="w-full max-w-3xl mx-auto animate-rise">
        <div className="bg-white rounded-3xl shadow-xl border border-slate-100 p-6 md:p-8 relative overflow-hidden">
          <div className="absolute top-0 left-0 h-1 bg-gradient-to-r from-sky-500 to-blue-600 transition-all duration-700" style={{ width: `${Math.max(4, (groups / Math.max(1, total)) * 100)}%` }} />
          <div className="flex items-center gap-4">
            <div className="relative w-14 h-14 flex items-center justify-center flex-shrink-0">
              <span className="absolute inset-0 rounded-2xl border-2 border-dashed border-sky-300 animate-spin-slow" />
              <LogoMark size={40} className="animate-float" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-xl font-display font-bold text-slate-900">Setting your paper{currentSection ? ` · Section ${currentSection}` : ''}…</h3>
              <p className="text-sm text-slate-500 flex items-center gap-2">
                {waiting > 0 ? <><Hourglass className="w-4 h-4 text-amber-500" /> Pacing requests for the free AI tier · {waiting}s</> : <><span className="typing-dots text-sky-400"><span></span><span></span><span></span></span> Writing questions and mark schemes</>}
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-display font-bold tabular-nums">{groups}<span className="text-slate-300 text-xl">/{total}</span></p>
              <button onClick={() => abortRef.current?.abort()} className="text-xs font-bold text-slate-400 hover:text-rose-600 flex items-center gap-1 ml-auto mt-1"><Square className="w-3 h-3 fill-current" /> Cancel</button>
            </div>
          </div>
          <ul className="mt-6 space-y-2 max-h-[55dvh] overflow-y-auto" data-lenis-prevent>
            {built.map(q => (
              <li key={q.id} className="msg-in flex items-start gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-500 flex-shrink-0">{q.section_id}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex gap-1.5 mb-1"><TypeBadge type={q.type} /><span className="text-[11px] font-bold text-slate-500">[{q.marks}]</span></div>
                  <p className="text-sm text-slate-700 line-clamp-2">{q.parent_stem ? `${q.parent_stem.slice(0, 80)}… ` : ''}{q.question}</p>
                </div>
              </li>
            ))}
            <li className="h-16 rounded-2xl shimmer" />
          </ul>
        </div>
      </div>
    );
  }

  const input = 'rounded-lg border-slate-200 text-sm py-1.5 focus:border-sky-500 focus:ring-sky-500';
  return (
    <div className="w-full max-w-3xl bg-white rounded-3xl shadow-xl border border-slate-100 p-6 md:p-8 relative overflow-hidden text-left tool-card spotlight space-y-7">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-sky-500 to-blue-600"></div>

      <section>
        <p className="flex items-center gap-2 text-[11px] font-bold text-slate-500 uppercase tracking-[0.14em] mb-2.5"><Files className="w-3.5 h-3.5" /> Source material</p>
        <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto" data-lenis-prevent>
          {documents.map(doc => {
            const on = docIds.includes(doc.id);
            return (
              <button key={doc.id} type="button" onClick={() => toggleDoc(doc.id)}
                className={`flex items-center gap-2 max-w-full px-3 py-2 rounded-xl border text-sm font-medium transition-all ${on ? 'border-sky-500 bg-sky-50 text-sky-800' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                <span className={`w-4 h-4 rounded flex items-center justify-center ${on ? 'bg-sky-600 text-white' : 'border border-slate-300'}`}>{on && <Check className="w-3 h-3" />}</span>
                <span className="truncate">{doc.title}</span>
              </button>
            );
          })}
        </div>
        <button type="button" onClick={() => setShowChapters(v => !v)} className="mt-2 text-xs font-semibold text-sky-700 hover:underline">
          {showChapters ? 'Cover the whole document' : 'Only examine chosen chapters / pages…'}
        </button>
        {showChapters && (
          <div className="mt-2 flex flex-wrap gap-1.5 animate-fade-in">
            {!outline.length && <span className="text-xs text-slate-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</span>}
            {outline.map(o => {
              const on = chapters.includes(o.label);
              return <button key={o.label} type="button" onClick={() => setChapters(p => on ? p.filter(x => x !== o.label) : [...p, o.label])}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${on ? 'bg-sky-600 text-white border-sky-600' : 'border-slate-200 text-slate-600'}`}>{o.label}</button>;
            })}
          </div>
        )}
      </section>

      {/* Past paper */}
      <section className="rounded-2xl border border-dashed border-slate-200 p-4">
        <p className="flex items-center gap-2 text-sm font-bold text-slate-700"><ScrollText className="w-4 h-4 text-sky-500" /> Model on a past paper <span className="text-xs font-normal text-slate-400">(optional)</span></p>
        {modelledOn ? (
          <div className="mt-2 flex items-start gap-2 text-sm text-sky-900 bg-sky-50 rounded-xl p-3 animate-fade-in">
            <span className="flex-1">Copying the structure and style of <span className="font-semibold">{modelledOn}</span>. {styleNotes}</span>
            <button type="button" onClick={() => { setModelledOn(null); setStyleNotes(null); }} className="text-sky-600" aria-label="Stop using the past paper"><X className="w-4 h-4" /></button>
          </div>
        ) : (
          <div className="mt-2 flex gap-2">
            <select value={pastPaperId} onChange={e => setPastPaperId(e.target.value)} className="flex-1 min-w-0 rounded-lg border-slate-200 text-sm py-1.5" aria-label="Past paper">
              <option value="">Upload a past paper to Documents, then choose it here…</option>
              {documents.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
            <button type="button" disabled={!pastPaperId || analysing} onClick={async () => {
              setAnalysing(true);
              setError(null);
              try {
                const bp = await pastPaperAPI.blueprint(pastPaperId);
                setSections(bp.sections);
                setDuration(bp.duration_minutes);
                setStyleNotes(bp.style_notes);
                setModelledOn(bp.paper_title);
              } catch (err) {
                setError(getErrorMessage(err, 'Could not read that past paper.'));
              } finally {
                setAnalysing(false);
              }
            }} className="px-3 rounded-lg bg-sky-600 text-white text-sm font-bold disabled:opacity-40 flex items-center gap-1.5">
              {analysing && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Copy its format
            </button>
          </div>
        )}
      </section>

      {/* Blueprint */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <p className="flex items-center gap-2 text-[11px] font-bold text-slate-500 uppercase tracking-[0.14em]"><Layers className="w-3.5 h-3.5" /> Paper blueprint</p>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map(p => <button key={p.label} type="button" title={p.hint} onClick={() => { setSections(p.sections); setDuration(null); }}
              className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-slate-500 border border-slate-200 hover:border-sky-300 hover:text-sky-700">{p.label}</button>)}
          </div>
        </div>
        <div className="space-y-2.5">
          {sections.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2.5 p-3 rounded-2xl border border-slate-100 bg-slate-50/60 animate-fade-in">
              <span className={`w-8 h-8 rounded-xl ${KIND_INFO[s.kind].tone} text-white font-display font-bold flex items-center justify-center`}>{String.fromCharCode(65 + i)}</span>
              <select value={s.kind} onChange={e => update(i, { kind: e.target.value as BlueprintSection['kind'], marks_each: KIND_INFO[e.target.value as BlueprintSection['kind']].marks, subparts: false })} className={input}>
                {Object.entries(KIND_INFO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                <input type="number" min={1} max={30} value={s.count} onChange={e => update(i, { count: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} className={`${input} w-16`} /> questions
              </label>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                × <input type="number" min={1} max={50} value={s.marks_each} onChange={e => update(i, { marks_each: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} className={`${input} w-16`} /> marks
              </label>
              {s.kind !== 'objective' && (
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500" title="Students choose which questions to answer">
                  answer any <input type="number" min={0} max={s.count} value={s.attempt_any ?? 0} onChange={e => update(i, { attempt_any: Number(e.target.value) || null })} className={`${input} w-14`} />
                </label>
              )}
              {s.kind === 'long' && (
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500" title="Structured questions with parts (a), (b), (c)">
                  <input type="checkbox" checked={!!s.subparts} onChange={e => update(i, { subparts: e.target.checked })} className="rounded border-slate-300" /> sub-parts
                </label>
              )}
              <span className="ml-auto text-sm font-bold text-slate-700 tabular-nums">{sectionMarks(s)} marks</span>
              {sections.length > 1 && <button type="button" onClick={() => setSections(p => p.filter((_, j) => j !== i))} className="p-1 text-slate-300 hover:text-rose-500" aria-label="Remove section"><Trash2 className="w-4 h-4" /></button>}
            </div>
          ))}
          {sections.length < 4 && (
            <button type="button" onClick={() => setSections(p => [...p, { kind: 'short', count: 3, marks_each: 4 }])} className="w-full py-2 rounded-2xl border-2 border-dashed border-slate-200 text-sm font-semibold text-slate-400 hover:border-sky-300 hover:text-sky-700 flex items-center justify-center gap-1.5">
              <Plus className="w-4 h-4" /> Add section
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5 font-bold text-slate-800"><Award className="w-4 h-4 text-amber-500" /> {totalMarks} marks</span>
          <span className="flex items-center gap-1.5 text-slate-600"><Clock className="w-4 h-4 text-sky-500" />
            <input type="number" min={5} max={360} value={minutes} onChange={e => setDuration(Math.max(5, Number(e.target.value) || 5))} className={`${input} w-20`} /> minutes
            {duration !== null && <button type="button" onClick={() => setDuration(null)} className="text-xs text-sky-700 hover:underline">auto</button>}
          </span>
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-bold text-slate-500 uppercase tracking-[0.14em] mb-2.5"><Target className="w-3.5 h-3.5" /> Difficulty</p>
          <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-xl">
            {(['easy', 'medium', 'hard', 'mixed'] as DifficultySetting[]).map(d => (
              <button key={d} type="button" onClick={() => setDifficulty(d)} className={`py-2 rounded-lg text-sm font-semibold capitalize transition-all ${difficulty === d ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{d}</button>
            ))}
          </div>
        </div>
        <div>
          <p className="flex items-center gap-2 text-[11px] font-bold text-slate-500 uppercase tracking-[0.14em] mb-2.5"><Wand2 className="w-3.5 h-3.5" /> Thinking level</p>
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl">
            {([['recall', 'Recall'], ['balanced', 'Balanced'], ['higher', 'Deeper']] as [BloomPreset, string][]).map(([v, l]) => (
              <button key={v} type="button" onClick={() => setBloom(v)} className={`py-2 rounded-lg text-sm font-semibold transition-all ${bloom === v ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{l}</button>
            ))}
          </div>
        </div>
      </section>

      <button type="button" onClick={generate} disabled={!docIds.length || (showChapters && !chapters.length)} data-cursor="Set paper"
        className="btn-shine group w-full bg-gradient-to-r from-sky-500 to-blue-600 text-white py-4 rounded-2xl font-bold shadow-lg shadow-sky-500/25 flex items-center justify-center gap-2 disabled:opacity-50">
        <Sparkles className="w-5 h-5" /> Set a {totalMarks}-mark paper <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
      </button>
      {error && <p className="text-sm text-rose-600 bg-rose-50 rounded-xl p-3">{error}</p>}
    </div>
  );
};
