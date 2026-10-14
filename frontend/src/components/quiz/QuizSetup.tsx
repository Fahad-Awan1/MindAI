import React, { useEffect, useRef, useState } from 'react';
import {
  Check, ChevronRight, Files, Hourglass, Layers, ListChecks, Loader2, Sparkles, Square, Target, Wand2, X,
} from 'lucide-react';
import { DocumentFile, StudySet, TopicStat } from '../../types';
import { assessmentAPI, topicsAPI, getErrorMessage } from '../../services/api';
import { BloomPreset, DifficultySetting, GenerationEvent, Question, QuizQuestionType, TYPE_LABELS } from '../../assessment/types';
import { TypeBadge } from './bits';
import { LogoMark } from '../Logo';

const WEAK_TOPIC_THRESHOLD = 70;
const ALL_TYPES: QuizQuestionType[] = ['mcq', 'multi_select', 'true_false', 'fill_blank', 'matching', 'ordering', 'numeric', 'short_answer'];
const TYPE_PRESETS: { label: string; types: QuizQuestionType[] }[] = [
  { label: 'Classic', types: ['mcq'] },
  { label: 'Quick mix', types: ['mcq', 'true_false', 'fill_blank'] },
  { label: 'Everything', types: ALL_TYPES },
];
const TYPE_HINTS: Record<QuizQuestionType, string> = {
  mcq: 'Pick one of four',
  multi_select: 'Several correct answers',
  true_false: 'Spot the subtle error',
  fill_blank: 'Recall key terms',
  matching: 'Link terms to meanings',
  ordering: 'Sequence the steps',
  numeric: 'Calculate a value',
  short_answer: 'Explain in your words (AI-marked)',
};

type Scope = 'whole' | 'sections' | 'topics';

interface QuizSetupProps {
  documents: DocumentFile[];
  primaryDocId: string;
  onPrimaryDocChange: (id: string) => void;
  onReady: (set: StudySet<unknown>) => void;
}

const Segmented = <T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void }) => (
  <div className="relative grid p-1 bg-slate-100 rounded-xl" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
    <span
      className="absolute top-1 bottom-1 left-1 rounded-lg bg-white shadow-sm transition-transform duration-500 ease-out-expo"
      style={{ width: `calc((100% - 0.5rem) / ${options.length})`, transform: `translateX(${options.findIndex(o => o.value === value) * 100}%)` }}
      aria-hidden="true"
    />
    {options.map(o => (
      <button key={o.value} type="button" onClick={() => onChange(o.value)} title={o.hint}
        className={`relative z-10 py-2 px-2 rounded-lg text-sm font-semibold transition-colors ${value === o.value ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
        {o.label}
      </button>
    ))}
  </div>
);

const Label: React.FC<{ icon: React.ElementType; children: React.ReactNode; aside?: React.ReactNode }> = ({ icon: Icon, children, aside }) => (
  <div className="flex items-center justify-between mb-2.5">
    <span className="flex items-center gap-2 text-[11px] font-bold text-slate-500 uppercase tracking-[0.14em]"><Icon className="w-3.5 h-3.5" /> {children}</span>
    {aside}
  </div>
);

export const QuizSetup: React.FC<QuizSetupProps> = ({ documents, primaryDocId, onPrimaryDocChange, onReady }) => {
  const [docIds, setDocIds] = useState<string[]>(primaryDocId ? [primaryDocId] : []);
  const [scope, setScope] = useState<Scope>('whole');
  const [outline, setOutline] = useState<{ label: string; chars: number }[]>([]);
  const [sections, setSections] = useState<string[]>([]);
  const [topicInput, setTopicInput] = useState('');
  const [topics, setTopics] = useState<string[]>([]);
  const [count, setCount] = useState(10);
  const [types, setTypes] = useState<QuizQuestionType[]>(['mcq', 'true_false', 'fill_blank']);
  const [difficulty, setDifficulty] = useState<DifficultySetting>('mixed');
  const [bloom, setBloom] = useState<BloomPreset>('balanced');
  const [topicStats, setTopicStats] = useState<TopicStat[]>([]);
  const [focusWeak, setFocusWeak] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Building state
  const [building, setBuilding] = useState(false);
  const [built, setBuilt] = useState<Question[]>([]);
  const [total, setTotal] = useState(0);
  const [waiting, setWaiting] = useState(0);
  const [warning, setWarning] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const primary = docIds[0] || primaryDocId;
  const weak = topicStats.filter(t => t.accuracy_pct < WEAK_TOPIC_THRESHOLD);

  // Keep the parent's selected document in sync with the first chosen document
  useEffect(() => {
    if (primaryDocId && !docIds.length) setDocIds([primaryDocId]);
  }, [primaryDocId]);

  useEffect(() => {
    if (!primary) return;
    let cancelled = false;
    topicsAPI.get(primary).then(r => { if (!cancelled) setTopicStats(r); }).catch(() => {});
    if (scope === 'sections') {
      assessmentAPI.outline(primary).then(r => { if (!cancelled) setOutline(r); }).catch(() => setOutline([]));
    }
    return () => { cancelled = true; };
  }, [primary, scope]);

  useEffect(() => {
    if (!weak.length) setFocusWeak(false);
  }, [weak.length]);

  // Waiting countdown
  useEffect(() => {
    if (waiting <= 0) return;
    const t = window.setTimeout(() => setWaiting(w => Math.max(0, w - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [waiting]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const toggleDoc = (id: string) => {
    setDocIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : prev.length >= 5 ? prev : [...prev, id];
      if (next.length && next[0] !== prev[0]) onPrimaryDocChange(next[0]);
      return next.length ? next : prev;
    });
    setSections([]);
  };

  const toggleType = (t: QuizQuestionType) =>
    setTypes(prev => (prev.includes(t) ? (prev.length > 1 ? prev.filter(x => x !== t) : prev) : [...prev, t]));

  const addTopic = () => {
    const parts = topicInput.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length) setTopics(prev => Array.from(new Set([...prev, ...parts])).slice(0, 10));
    setTopicInput('');
  };

  const generate = async () => {
    setError(null);
    setWarning(null);
    setBuilt([]);
    setTotal(count);
    setBuilding(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let finished: StudySet<unknown> | null = null;
      await assessmentAPI.streamQuiz({
        document_ids: docIds,
        count,
        types,
        difficulty,
        bloom,
        sections: scope === 'sections' ? sections : [],
        topics: scope === 'topics' ? topics : [],
        focus_weak_topics: focusWeak,
      }, (event: GenerationEvent) => {
        if (event.type === 'plan') setTotal(event.total);
        else if (event.type === 'waiting') setWaiting(event.seconds);
        else if (event.type === 'question') { setWaiting(0); setBuilt(prev => [...prev, event.question]); }
        else if (event.type === 'warning') setWarning(event.message);
        else if (event.type === 'done') finished = event.set;
      }, controller.signal);
      if (finished) onReady(finished);
      else setError('The quiz could not be saved. Please try again.');
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') setError(getErrorMessage(err, 'Failed to generate the quiz. Please try again.'));
    } finally {
      setBuilding(false);
      abortRef.current = null;
    }
  };

  if (building) {
    const pct = total ? Math.round((built.length / total) * 100) : 0;
    return (
      <div className="w-full max-w-3xl mx-auto animate-rise">
        <div className="bg-white rounded-3xl shadow-xl border border-slate-100 p-6 md:p-8 relative overflow-hidden">
          <div className="absolute top-0 left-0 h-1 bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 transition-all duration-700 ease-out-expo" style={{ width: `${Math.max(4, pct)}%` }} />
          <div className="flex items-center gap-4">
            <div className="relative w-14 h-14 flex items-center justify-center flex-shrink-0">
              <span className="absolute inset-0 rounded-2xl border-2 border-dashed border-indigo-300 animate-spin-slow" />
              <LogoMark size={40} className="animate-float" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-xl font-display font-bold text-slate-900">Building your quiz…</h3>
              <p className="text-sm text-slate-500 flex items-center gap-2">
                {waiting > 0
                  ? <><Hourglass className="w-4 h-4 text-amber-500" /> Pacing requests for the free AI tier · next batch in {waiting}s</>
                  : <><span className="typing-dots text-indigo-400"><span></span><span></span><span></span></span> Reading your documents and writing questions</>}
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-display font-bold text-slate-900 tabular-nums">{built.length}<span className="text-slate-300 text-xl">/{total}</span></p>
              <button onClick={() => abortRef.current?.abort()} className="text-xs font-bold text-slate-400 hover:text-rose-600 flex items-center gap-1 ml-auto mt-1"><Square className="w-3 h-3 fill-current" /> Cancel</button>
            </div>
          </div>
          <ul className="mt-6 space-y-2 max-h-[55dvh] overflow-y-auto pr-1" data-lenis-prevent>
            {built.map((q, i) => (
              <li key={q.id} className="msg-in flex items-start gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-100">
                <span className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-500 flex items-center justify-center flex-shrink-0">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-1.5 mb-1"><TypeBadge type={q.type} />{q.source?.location && <span className="text-[11px] text-slate-400 truncate">{q.source.location}</span>}</div>
                  <p className="text-sm text-slate-700 line-clamp-2">{q.question}</p>
                </div>
              </li>
            ))}
            {Array.from({ length: Math.max(0, total - built.length) }).slice(0, 3).map((_, i) => (
              <li key={`s${i}`} className="h-[68px] rounded-2xl shimmer" style={{ opacity: 1 - i * 0.3 }} />
            ))}
          </ul>
          {warning && <p className="mt-3 text-sm text-amber-700 bg-amber-50 rounded-xl p-2.5">{warning}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl bg-white rounded-3xl shadow-xl border border-slate-100 p-6 md:p-8 relative overflow-hidden text-left tool-card spotlight space-y-7">
      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-primary-500"></div>

      {/* Documents */}
      <section>
        <Label icon={Files} aside={<span className="text-[11px] text-slate-400">{docIds.length}/5 selected</span>}>Source material</Label>
        <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto" data-lenis-prevent>
          {documents.map(doc => {
            const on = docIds.includes(doc.id);
            return (
              <button key={doc.id} type="button" onClick={() => toggleDoc(doc.id)}
                className={`flex items-center gap-2 max-w-full px-3 py-2 rounded-xl border text-sm font-medium transition-all duration-300 ${on ? 'border-primary-500 bg-primary-50 text-primary-800 shadow-sm' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 ${on ? 'bg-primary-600 text-white' : 'border border-slate-300'}`}>{on && <Check className="w-3 h-3" />}</span>
                <span className="truncate">{doc.title}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Scope */}
      <section>
        <Label icon={Layers}>What to cover</Label>
        <Segmented<Scope> value={scope} onChange={setScope} options={[
          { value: 'whole', label: 'Everything', hint: 'Questions spread across the whole of every document' },
          { value: 'sections', label: 'Sections', hint: 'Only chosen chapters / pages' },
          { value: 'topics', label: 'Topics', hint: 'Only what relates to chosen topics' },
        ]} />
        {scope === 'sections' && (
          <div className="mt-3 flex flex-wrap gap-1.5 max-h-40 overflow-y-auto animate-fade-in" data-lenis-prevent>
            {outline.length === 0 && <p className="text-xs text-slate-400 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Loading sections of the first document…</p>}
            {outline.map(s => {
              const on = sections.includes(s.label);
              return (
                <button key={s.label} type="button" onClick={() => setSections(prev => on ? prev.filter(x => x !== s.label) : [...prev, s.label])}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`}>
                  {s.label}
                </button>
              );
            })}
          </div>
        )}
        {scope === 'topics' && (
          <div className="mt-3 animate-fade-in">
            <div className="flex gap-2">
              <input value={topicInput} onChange={e => setTopicInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTopic(); } }}
                placeholder="e.g. osmosis, enzymes (press Enter)" className="flex-1 rounded-xl border-slate-200 bg-slate-50 py-2 text-sm focus:bg-white focus:border-indigo-500 focus:ring-indigo-500" />
              <button type="button" onClick={addTopic} className="px-3 rounded-xl bg-slate-900 text-white text-sm font-bold">Add</button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {topics.map(t => (
                <span key={t} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-semibold">
                  {t}<button type="button" onClick={() => setTopics(prev => prev.filter(x => x !== t))} aria-label={`Remove ${t}`}><X className="w-3 h-3" /></button>
                </span>
              ))}
              {topicStats.filter(t => !topics.includes(t.topic) && t.topic !== 'General').slice(0, 6).map(t => (
                <button key={t.topic} type="button" onClick={() => setTopics(prev => [...prev, t.topic])} className="px-2.5 py-1 rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 hover:border-indigo-300 hover:text-indigo-700">+ {t.topic}</button>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Count */}
      <section>
        <Label icon={ListChecks} aside={<span className="text-lg font-display font-bold text-primary-600 tabular-nums">{count}</span>}>Questions</Label>
        <input type="range" min={3} max={30} value={count} onChange={e => setCount(Number(e.target.value))} className="w-full accent-primary-600" />
        <div className="flex justify-between text-[11px] text-slate-400 mt-1"><span>3</span><span>~{Math.max(1, Math.round(count * 0.75))} min</span><span>30</span></div>
      </section>

      {/* Types */}
      <section>
        <Label icon={Sparkles} aside={
          <div className="flex gap-1">
            {TYPE_PRESETS.map(p => (
              <button key={p.label} type="button" onClick={() => setTypes(p.types)} className="px-2 py-0.5 rounded-md text-[11px] font-semibold text-slate-500 hover:bg-slate-100">{p.label}</button>
            ))}
          </div>
        }>Question types</Label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {ALL_TYPES.map(t => {
            const on = types.includes(t);
            return (
              <button key={t} type="button" onClick={() => toggleType(t)} title={TYPE_HINTS[t]}
                className={`relative text-left p-2.5 rounded-xl border-2 transition-all duration-300 ${on ? 'border-primary-500 bg-primary-50/60' : 'border-slate-100 hover:border-slate-200'}`}>
                <span className={`absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center ${on ? 'bg-primary-600 text-white' : 'border border-slate-300'}`}>{on && <Check className="w-3 h-3" />}</span>
                <span className="block text-[13px] font-bold text-slate-800 pr-5">{TYPE_LABELS[t]}</span>
                <span className="block text-[11px] text-slate-400 leading-tight mt-0.5">{TYPE_HINTS[t]}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Difficulty + thinking level */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <Label icon={Target}>Difficulty</Label>
          <Segmented<DifficultySetting> value={difficulty} onChange={setDifficulty} options={[
            { value: 'easy', label: 'Easy' }, { value: 'medium', label: 'Medium' }, { value: 'hard', label: 'Hard' }, { value: 'mixed', label: 'Mixed' },
          ]} />
        </div>
        <div>
          <Label icon={Wand2}>Thinking level</Label>
          <Segmented<BloomPreset> value={bloom} onChange={setBloom} options={[
            { value: 'recall', label: 'Recall', hint: 'Mostly remembering facts' },
            { value: 'balanced', label: 'Balanced', hint: 'Recall, understanding and application' },
            { value: 'higher', label: 'Deeper', hint: 'Application, analysis and evaluation' },
          ]} />
        </div>
      </section>

      {/* Weak topics */}
      <section className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-bold text-slate-800 text-sm flex items-center gap-2"><Target className="w-4 h-4 text-rose-500" /> Focus on my weak topics</p>
            <p className="text-xs text-slate-500 mt-0.5">Most questions target topics you've scored under {WEAK_TOPIC_THRESHOLD}% on.</p>
          </div>
          <button type="button" role="switch" aria-checked={focusWeak} disabled={!weak.length} onClick={() => setFocusWeak(v => !v)}
            className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-40 ${focusWeak ? 'bg-primary-600' : 'bg-slate-300'}`}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-300 ${focusWeak ? 'translate-x-5' : ''}`} />
          </button>
        </div>
        {weak.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {weak.slice(0, 6).map(t => (
              <span key={t.topic} className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-600">{t.topic} <span className="text-rose-500">{t.accuracy_pct}%</span></span>
            ))}
          </div>
        ) : <p className="text-xs text-slate-400 mt-2">Take a quiz and MindAI will learn which topics you find hard.</p>}
      </section>

      <button type="button" onClick={generate} disabled={!docIds.length || (scope === 'sections' && !sections.length) || (scope === 'topics' && !topics.length)}
        data-cursor="Generate"
        className="btn-shine group w-full bg-gradient-to-r from-primary-600 via-violet-600 to-indigo-600 text-white py-4 rounded-2xl font-bold shadow-lg shadow-primary-500/25 hover:shadow-primary-500/40 transition-all duration-500 flex items-center justify-center gap-2 disabled:opacity-50">
        <Sparkles className="w-5 h-5" /> Generate {count} questions
        <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
      </button>
      {error && <p className="text-red-600 text-sm font-medium bg-red-50 p-3 rounded-xl animate-slide-up">{error}</p>}
    </div>
  );
};
