import React, { useEffect, useRef, useState } from 'react';
import {
  Eye, EyeOff, Gauge, GraduationCap, Heart, Loader2, Pencil, Play, Plus, Shuffle, Timer, Zap, Brain,
} from 'lucide-react';
import { assessmentAPI, getErrorMessage } from '../../services/api';
import { GenerationEvent, Question, QuizMode } from '../../assessment/types';
import { answerText } from '../../assessment/grading';
import { Source, StudySet } from '../../types';
import { BloomBadge, DifficultyBadge, SourceChip, TypeBadge } from './bits';
import { ExportMenu } from './ExportMenu';
import { EditForm } from './EditForm';
import { QuestionActions } from './QuestionActions';

export interface PlayConfig {
  mode: QuizMode;
  /** Whole-quiz time limit in seconds (test mode), or per question (speed) */
  timeLimit: number | null;
  shuffle: boolean;
  lives: number;
}

const MODES: { mode: QuizMode; icon: React.ElementType; title: string; text: string; tone: string }[] = [
  { mode: 'practice', icon: GraduationCap, title: 'Practice', text: 'Check each answer as you go, with hints and explanations.', tone: 'from-emerald-500 to-teal-500' },
  { mode: 'test', icon: Timer, title: 'Test', text: 'Timed, no feedback until you finish - like the real thing.', tone: 'from-indigo-500 to-violet-600' },
  { mode: 'adaptive', icon: Brain, title: 'Adaptive', text: 'Gets harder when you\'re right, easier when you slip.', tone: 'from-fuchsia-500 to-pink-500' },
  { mode: 'speed', icon: Zap, title: 'Speed run', text: '20 seconds per question. Think fast.', tone: 'from-amber-500 to-orange-500' },
  { mode: 'survival', icon: Heart, title: 'Survival', text: 'Three lives. How far can you get?', tone: 'from-rose-500 to-red-500' },
];

interface QuizEditorProps {
  set: StudySet<unknown>;
  questions: Question[];
  onQuestionsChange: (questions: Question[], set?: StudySet<unknown>) => void;
  onStart: (config: PlayConfig) => void;
  onOpenSource?: (source: Source) => void;
}

/** The saved quiz before playing: review and edit questions, then choose how to play. */
export const QuizEditor: React.FC<QuizEditorProps> = ({ set, questions, onQuestionsChange, onStart, onOpenSource }) => {
  const [showKey, setShowKey] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<QuizMode>('practice');
  const [timed, setTimed] = useState(true);
  const [minutes, setMinutes] = useState(Math.max(2, Math.ceil(questions.length * 0.9)));
  const [shuffle, setShuffle] = useState(false);
  const [adding, setAdding] = useState<{ total: number; got: number } | null>(null);
  const [addCount, setAddCount] = useState(5);

  const runBusy = async (qid: string, label: string, action: () => Promise<void>) => {
    setBusy(b => ({ ...b, [qid]: label }));
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(getErrorMessage(err, 'That action failed. Please try again.'));
    } finally {
      setBusy(b => { const n = { ...b }; delete n[qid]; return n; });
    }
  };

  const regenerate = (q: Question, how: 'same' | 'harder' | 'easier') => runBusy(q.id, how, async () => {
    const r = await assessmentAPI.regenerate(set.id, q.id, how);
    onQuestionsChange(questions.map(x => (x.id === q.id ? r.question : x)), r.set);
  });

  const remove = (q: Question) => runBusy(q.id, 'delete', async () => {
    const updated = await assessmentAPI.deleteQuestion(set.id, q.id);
    onQuestionsChange(questions.filter(x => x.id !== q.id), updated);
  });

  // Stop generating if the user leaves this screen
  const addAbort = useRef<AbortController | null>(null);
  useEffect(() => () => addAbort.current?.abort(), []);

  const addMore = async () => {
    setAdding({ total: addCount, got: 0 });
    setError(null);
    const controller = new AbortController();
    addAbort.current = controller;
    try {
      let current = questions;
      await assessmentAPI.streamAddMore(set.id, { count: addCount }, (event: GenerationEvent) => {
        if (event.type === 'question') {
          current = [...current, event.question];
          onQuestionsChange(current);
          setAdding(a => a && { ...a, got: a.got + 1 });
        } else if (event.type === 'done') onQuestionsChange(current, event.set);
        else if (event.type === 'warning') setError(event.message);
      }, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(getErrorMessage(err, 'Could not add questions.'));
    } finally {
      if (addAbort.current === controller) addAbort.current = null;
      if (!controller.signal.aborted) setAdding(null);
    }
  };

  const start = () => onStart({
    mode,
    timeLimit: mode === 'test' && timed ? minutes * 60 : mode === 'speed' ? 20 : null,
    shuffle,
    lives: 3,
  });

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Mode picker */}
      <div className="bg-white rounded-3xl shadow-xl border border-slate-100 p-6 md:p-7 animate-rise no-print">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <p className="page-eyebrow text-primary-600">Ready · {questions.length} questions</p>
            {renaming !== null ? (
              <form className="flex flex-wrap items-center gap-2 mt-1" onSubmit={async e => {
                e.preventDefault();
                if (!renaming.trim()) return;
                try {
                  const updated = await assessmentAPI.updateMeta(set.id, { title: renaming.trim() });
                  onQuestionsChange(questions, updated);
                  setRenaming(null);
                } catch (err) {
                  setError(getErrorMessage(err, 'Could not rename the quiz.'));
                }
              }}>
                <input autoFocus value={renaming} onChange={e => setRenaming(e.target.value)} maxLength={200}
                  className="min-w-0 flex-1 basis-48 text-xl font-display font-bold rounded-xl border-slate-200 py-1.5 focus:border-primary-500 focus:ring-primary-500" aria-label="Quiz title" />
                <button type="submit" className="px-3 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold">Save</button>
                <button type="button" onClick={() => setRenaming(null)} className="px-2 py-2 text-sm text-slate-500">Cancel</button>
              </form>
            ) : (
              <h2 className="group/title text-2xl md:text-3xl font-display font-bold text-slate-900 mt-1 flex items-center gap-2 break-anywhere">
                {set.title}
                <button onClick={() => setRenaming(set.title)} className="p-2 flex-shrink-0 rounded-lg text-slate-300 hover:text-slate-700 hover:bg-slate-100" title="Rename" aria-label="Rename quiz"><Pencil className="w-4 h-4" /></button>
              </h2>
            )}
            {set.best_score_pct !== null && <p className="text-sm text-slate-500 mt-1">Best so far: <span className="font-bold text-slate-800">{set.best_score_pct}%</span> · {set.attempts} attempt{set.attempts === 1 ? '' : 's'}</p>}
          </div>
          <ExportMenu setId={set.id} title={set.title} questions={questions} kind="quiz" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
          {MODES.map(m => {
            const on = mode === m.mode;
            return (
              <button key={m.mode} type="button" onClick={() => setMode(m.mode)}
                className={`relative overflow-hidden text-left p-3.5 rounded-2xl border-2 transition-all duration-500 ease-out-expo ${on ? 'border-slate-900 shadow-xl -translate-y-1 bg-white' : 'border-slate-100 hover:border-slate-200 hover:-translate-y-0.5'}`}>
                {on && <span className={`absolute inset-0 bg-gradient-to-br ${m.tone} opacity-[0.08]`} />}
                <span className={`relative w-9 h-9 rounded-xl bg-gradient-to-br ${m.tone} text-white flex items-center justify-center mb-2 shadow-md`}><m.icon className="w-5 h-5" /></span>
                <span className="relative block font-bold text-slate-900 text-sm">{m.title}</span>
                <span className="relative block text-[11px] leading-snug text-slate-500 mt-0.5">{m.text}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-5">
          {mode === 'test' && (
            <label className="flex items-center gap-2 text-sm text-slate-600 font-medium">
              <input type="checkbox" checked={timed} onChange={e => setTimed(e.target.checked)} className="rounded border-slate-300" /> Time limit
              <input type="number" min={1} max={180} value={minutes} disabled={!timed} onChange={e => setMinutes(Math.max(1, Number(e.target.value) || 1))}
                className="w-16 rounded-lg border-slate-200 py-1 text-sm disabled:opacity-40" /> min
            </label>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-600 font-medium">
            <input type="checkbox" checked={shuffle} onChange={e => setShuffle(e.target.checked)} className="rounded border-slate-300" />
            <Shuffle className="w-4 h-4" /> Shuffle questions &amp; options
          </label>
          <button type="button" onClick={start} data-cursor="Go"
            className="btn-shine ml-auto flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-primary-600 to-indigo-600 text-white font-bold shadow-lg shadow-primary-500/30 hover:shadow-primary-500/50 transition-shadow">
            <Play className="w-4 h-4 fill-current" /> Start {MODES.find(m => m.mode === mode)?.title}
          </button>
        </div>
      </div>

      {/* Questions */}
      <div className="flex items-center justify-between no-print">
        <h3 className="font-bold text-slate-800 flex items-center gap-2"><Gauge className="w-4 h-4 text-slate-400" /> Questions</h3>
        <button onClick={() => setShowKey(v => !v)} className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800">
          {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />} {showKey ? 'Hide answers' : 'Show answers'}
        </button>
      </div>
      {error && <p className="text-sm text-rose-600 bg-rose-50 rounded-xl p-3 no-print">{error}</p>}
      <ol className="space-y-3 print-content">
        {questions.map((q, i) => (
          <li key={q.id} className="break-inside-avoid bg-white rounded-2xl border border-slate-100 shadow-sm p-5 group hover:shadow-md transition-shadow duration-300" style={{ animation: `rise 0.8s cubic-bezier(0.16,1,0.3,1) ${Math.min(i, 10) * 50}ms backwards` }}>
            <div className="flex items-start gap-4">
              <span className="text-2xl font-display font-black text-slate-200 tabular-nums w-9 flex-shrink-0">{String(i + 1).padStart(2, '0')}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 mb-2 no-print">
                  <TypeBadge type={q.type} /><DifficultyBadge difficulty={q.difficulty} /><BloomBadge bloom={q.bloom} />
                  {q.topic && <span className="text-[11px] text-slate-400">· {q.topic}</span>}
                </div>
                <p className="font-semibold text-slate-800 leading-relaxed">{q.question}</p>
                {(q.type === 'mcq' || q.type === 'multi_select') && (
                  <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm text-slate-600">
                    {(q.options || []).map((o, j) => <li key={j}><span className="font-bold text-slate-400 mr-1.5">{String.fromCharCode(65 + j)}.</span>{o}</li>)}
                  </ul>
                )}
                {q.type === 'matching' && <p className="mt-2 text-sm text-slate-500">{(q.left || []).join(' · ')}  ⟷  {(q.right || []).join(' · ')}</p>}
                {q.type === 'ordering' && <p className="mt-2 text-sm text-slate-500">Items: {[...(q.items || [])].sort().join(' · ')}</p>}
                {showKey && (
                  <div className="mt-3 p-3 rounded-xl bg-emerald-50 border border-emerald-100 text-sm animate-fade-in">
                    <p className="font-bold text-emerald-800">Answer: <span className="font-semibold">{answerText(q)}</span></p>
                    {q.explanation && <p className="text-emerald-900/80 mt-1">{q.explanation}</p>}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2 no-print">
                  <SourceChip question={q} onOpen={onOpenSource} />
                  <span className="flex-1" />
                  <QuestionActions busy={busy[q.id]} editing={editing === q.id} onEdit={() => setEditing(editing === q.id ? null : q.id)}
                    onRegenerate={how => regenerate(q, how)} onDelete={() => remove(q)} />
                </div>
                {editing === q.id && (
                  <EditForm question={q} onCancel={() => setEditing(null)} onSave={async draft => {
                    const r = await assessmentAPI.editQuestion(set.id, q.id, draft);
                    onQuestionsChange(questions.map(x => (x.id === q.id ? r.question : x)), r.set);
                    setEditing(null);
                  }} />
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>

      {/* Add more */}
      <div className="flex flex-wrap items-center justify-center gap-3 p-5 rounded-2xl border-2 border-dashed border-slate-200 no-print">
        {adding ? (
          <span className="flex items-center gap-2 text-sm font-semibold text-primary-600"><Loader2 className="w-4 h-4 animate-spin" /> Adding questions… {adding.got}/{adding.total}</span>
        ) : (
          <>
            <span className="text-sm text-slate-500">Add</span>
            <select value={addCount} onChange={e => setAddCount(Number(e.target.value))} className="rounded-lg border-slate-200 text-sm py-1.5">
              {[3, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className="text-sm text-slate-500">more questions</span>
            <button onClick={addMore} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold btn-fill"><Plus className="w-4 h-4" /> Add</button>
          </>
        )}
      </div>
    </div>
  );
};
