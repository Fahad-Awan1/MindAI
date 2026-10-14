import React, { useState } from 'react';
import {
  Award, BookOpen, Brain, ChevronDown, Clock, Layers, Loader2, Plus, RotateCcw, Shuffle, Sparkles, Target, TrendingUp, XCircle, CheckCircle2, CircleDot,
} from 'lucide-react';
import { AnswerValue, AttemptResult, Breakdown, ItemResult, Question, QuizMode, ResponseItem, TYPE_LABELS, BLOOM_LABELS, Bloom, QuestionType } from '../../assessment/types';
import { emptyAnswer } from '../../assessment/grading';
import { CountUp } from '../../motion';
import { Confetti } from '../Confetti';
import { Source } from '../../types';
import { QuestionView, showsStem } from './QuestionView';
import { SourceChip, TypeBadge, formatDuration } from './bits';

interface QuizResultsProps {
  title: string;
  mode: QuizMode;
  questions: Question[];
  responses: ResponseItem[];
  result: AttemptResult | null;
  /** Shown when saving failed: results graded locally */
  fallback: ItemResult[] | null;
  saveWarning: string | null;
  durationMs: number;
  onRetake: (how: 'shuffle' | 'wrong') => void;
  onVariant: (qids: string[]) => Promise<void>;
  onToFlashcards: (qids: string[]) => Promise<string>;
  onNewQuiz: () => void;
  onExplain: (q: Question, answer: AnswerValue) => void;
  onOpenSource?: (source: Source) => void;
}

const verdict = (pct: number) =>
  pct === 100 ? 'Flawless!' : pct >= 85 ? 'Excellent work!' : pct >= 70 ? 'Great job!' : pct >= 50 ? 'Getting there' : 'Keep practising';

const ScoreRing: React.FC<{ pct: number }> = ({ pct }) => {
  const r = 54;
  const c = 2 * Math.PI * r;
  const color = pct >= 70 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#f43f5e';
  return (
    <div className="relative w-40 h-40 flex-shrink-0">
      <svg viewBox="0 0 128 128" className="w-full h-full -rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="12" />
        <circle cx="64" cy="64" r={r} fill="none" stroke={color} strokeWidth="12" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c} style={{ animation: 'ringFill 1.6s cubic-bezier(0.16,1,0.3,1) 0.2s forwards', ['--ring-to' as string]: `${c * (1 - pct / 100)}` }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
        <span className="text-4xl font-display font-bold tabular-nums"><CountUp value={pct} suffix="%" /></span>
        <span className="text-[11px] uppercase tracking-[0.2em] text-white/60">score</span>
      </div>
    </div>
  );
};

const LABELERS: Record<string, (label: string) => string> = {
  topic: l => l,
  type: l => TYPE_LABELS[l as QuestionType] || l,
  bloom: l => BLOOM_LABELS[l as Bloom] || l,
  difficulty: l => l.charAt(0).toUpperCase() + l.slice(1),
};

const BreakdownBars: React.FC<{ rows: Breakdown[]; kind: string }> = ({ rows, kind }) => (
  <ul className="space-y-3">
    {rows.map((row, i) => (
      <li key={row.label}>
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <span className="text-sm font-semibold text-slate-700 truncate">{LABELERS[kind](row.label)}</span>
          <span className="text-xs font-bold text-slate-500 tabular-nums">{row.correct}/{row.total} · {row.pct}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
          <div className={`h-full rounded-full origin-left ${row.pct >= 70 ? 'bg-emerald-500' : row.pct >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`}
            style={{ width: `${Math.max(3, row.pct)}%`, animation: `barX 1.2s cubic-bezier(0.16,1,0.3,1) ${i * 80}ms backwards` }} />
        </div>
      </li>
    ))}
  </ul>
);

export const QuizResults: React.FC<QuizResultsProps> = ({
  title, mode, questions, responses, result, fallback, saveWarning, durationMs, onRetake, onVariant, onToFlashcards, onNewQuiz, onExplain, onOpenSource,
}) => {
  const results = result?.results || fallback || [];
  const byId = new Map(results.map(r => [r.qid, r]));
  const responseById = new Map(responses.map(r => [r.qid, r]));
  const played = questions.filter(q => responseById.has(q.id));
  const pct = result ? result.score_pct : results.length ? Math.round((100 * results.reduce((s, r) => s + r.score, 0)) / results.length) : 0;
  const missed = played.filter(q => !byId.get(q.id)?.correct).map(q => q.id);
  const [tab, setTab] = useState<'topic' | 'type' | 'bloom' | 'difficulty'>('topic');
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(missed.slice(0, 3).map(id => [id, true])));
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sureWrong = played.filter(q => responseById.get(q.id)?.confidence === 3 && !byId.get(q.id)?.correct).length;
  const guessRight = played.filter(q => responseById.get(q.id)?.confidence === 1 && byId.get(q.id)?.correct).length;
  const rated = played.filter(q => responseById.get(q.id)?.confidence).length;
  const avgTime = played.length ? durationMs / played.length : 0;
  const breakdowns: Record<string, Breakdown[]> = result
    ? { topic: result.by_topic, type: result.by_type, bloom: result.by_bloom, difficulty: result.by_difficulty }
    : { topic: [], type: [], bloom: [], difficulty: [] };

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try { await action(); } finally { setBusy(null); }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-10">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-[2rem] bg-[#0b0a1a] text-white p-6 md:p-8 shadow-2xl shadow-violet-950/30 grain stack dialog-panel">
        <div className="mesh-blob w-80 h-80 -top-32 -left-20 bg-violet-600/50" />
        <div className="mesh-blob w-72 h-72 -bottom-32 right-0 bg-indigo-600/40" style={{ animationDelay: '-7s' }} />
        {pct >= 70 && <Confetti />}
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <ScoreRing pct={pct} />
          <div className="flex-1 text-center sm:text-left">
            <p className="page-eyebrow text-violet-300">{mode === 'review' ? 'Retake · wrong answers' : `${mode.charAt(0).toUpperCase() + mode.slice(1)} mode`}</p>
            <h2 className="text-3xl md:text-4xl font-display font-bold mt-1">{verdict(pct)}</h2>
            <p className="text-white/70 mt-1 truncate">{title}</p>
            <div className="mt-4 flex flex-wrap justify-center sm:justify-start gap-2 text-sm">
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10"><Award className="w-4 h-4 text-amber-300" /> {result ? result.score : results.filter(r => r.correct).length}/{played.length} correct</span>
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10"><Clock className="w-4 h-4 text-sky-300" /> {formatDuration(durationMs)} · {Math.round(avgTime / 1000)}s per question</span>
              {result?.previous_best_pct !== null && result?.previous_best_pct !== undefined && (
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10"><TrendingUp className="w-4 h-4 text-emerald-300" />
                  {pct > result.previous_best_pct ? `New best! (was ${result.previous_best_pct}%)` : `Best: ${result.previous_best_pct}%`}</span>
              )}
            </div>
          </div>
        </div>
      </div>
      {saveWarning && <p className="text-sm text-amber-700 bg-amber-50 rounded-xl p-3">{saveWarning}</p>}

      {/* Next steps */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 no-print">
        <button onClick={() => onRetake('shuffle')} className="lift spotlight p-4 rounded-2xl bg-white border border-slate-100 shadow-sm text-left">
          <Shuffle className="w-5 h-5 text-indigo-500 mb-2" /><span className="block font-bold text-slate-800 text-sm">Retake shuffled</span><span className="text-xs text-slate-400">Same questions, new order</span>
        </button>
        <button onClick={() => onRetake('wrong')} disabled={!missed.length} className="lift spotlight p-4 rounded-2xl bg-white border border-slate-100 shadow-sm text-left disabled:opacity-40">
          <RotateCcw className="w-5 h-5 text-rose-500 mb-2" /><span className="block font-bold text-slate-800 text-sm">Retry {missed.length} missed</span><span className="text-xs text-slate-400">Only what you got wrong</span>
        </button>
        <button onClick={() => run('variant', () => onVariant(missed))} disabled={!missed.length || !!busy} className="lift spotlight p-4 rounded-2xl bg-white border border-slate-100 shadow-sm text-left disabled:opacity-40">
          {busy === 'variant' ? <Loader2 className="w-5 h-5 text-violet-500 mb-2 animate-spin" /> : <Sparkles className="w-5 h-5 text-violet-500 mb-2" />}
          <span className="block font-bold text-slate-800 text-sm">Fresh questions</span><span className="text-xs text-slate-400">New questions on missed ideas</span>
        </button>
        <button onClick={() => run('cards', async () => setNotice(await onToFlashcards(missed)))} disabled={!missed.length || !!busy} className="lift spotlight p-4 rounded-2xl bg-white border border-slate-100 shadow-sm text-left disabled:opacity-40">
          {busy === 'cards' ? <Loader2 className="w-5 h-5 text-amber-500 mb-2 animate-spin" /> : <Layers className="w-5 h-5 text-amber-500 mb-2" />}
          <span className="block font-bold text-slate-800 text-sm">Missed → flashcards</span><span className="text-xs text-slate-400">Review them on schedule</span>
        </button>
      </div>
      {notice && <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-xl p-3 animate-slide-up">{notice}</p>}

      {/* Breakdown + calibration */}
      {result && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="md:col-span-3 bg-white rounded-3xl border border-slate-100 shadow-sm p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h3 className="font-bold text-slate-800 flex items-center gap-2"><Target className="w-4 h-4 text-slate-400" /> Where you stand</h3>
              <div className="flex bg-slate-100 rounded-lg p-0.5 text-xs font-semibold">
                {(['topic', 'type', 'bloom', 'difficulty'] as const).map(k => (
                  <button key={k} onClick={() => setTab(k)} className={`px-2.5 py-1 rounded-md transition-colors ${tab === k ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
                    {k === 'bloom' ? 'Thinking' : k.charAt(0).toUpperCase() + k.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <BreakdownBars key={tab} rows={breakdowns[tab]} kind={tab} />
          </div>
          <div className="md:col-span-2 bg-white rounded-3xl border border-slate-100 shadow-sm p-6">
            <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-4"><Brain className="w-4 h-4 text-slate-400" /> Confidence check</h3>
            {rated ? (
              <div className="space-y-3 text-sm">
                <p className="flex items-center justify-between"><span className="text-slate-600">Sure, but wrong</span><span className={`font-bold ${sureWrong ? 'text-rose-600' : 'text-emerald-600'}`}>{sureWrong}</span></p>
                <p className="flex items-center justify-between"><span className="text-slate-600">Guessed, and right</span><span className="font-bold text-amber-600">{guessRight}</span></p>
                <p className="text-xs text-slate-500 leading-relaxed pt-2 border-t border-slate-100">
                  {sureWrong ? 'Questions you were sure about but got wrong are misconceptions - they\'re the most valuable to review.'
                    : guessRight ? 'Lucky guesses aren\'t knowledge yet: review those topics so you can answer them with confidence.'
                      : 'Your confidence matched your answers - nicely calibrated!'}
                </p>
              </div>
            ) : <p className="text-sm text-slate-400">Tap “Sure / Unsure / Guessing” while answering next time to see how well your confidence matches your knowledge.</p>}
          </div>
        </div>
      )}

      {/* Review */}
      <div className="space-y-3">
        <h3 className="font-bold text-slate-800 flex items-center gap-2"><BookOpen className="w-4 h-4 text-slate-400" /> Review answers</h3>
        {played.map((q, i) => {
          const r = byId.get(q.id);
          const resp = responseById.get(q.id);
          const isOpen = !!open[q.id];
          const answer = resp?.answer ?? emptyAnswer(q);
          return (
            <div key={q.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-colors ${r?.correct ? 'border-emerald-100' : r && r.score > 0 ? 'border-amber-100' : 'border-rose-100'}`}>
              <button onClick={() => setOpen(o => ({ ...o, [q.id]: !isOpen }))} className="w-full flex items-center gap-3 p-4 text-left">
                {r?.correct ? <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" /> : r && r.score > 0 ? <CircleDot className="w-5 h-5 text-amber-500 flex-shrink-0" /> : <XCircle className="w-5 h-5 text-rose-500 flex-shrink-0" />}
                <span className="text-xs font-bold text-slate-400 w-6">{i + 1}</span>
                <span className="flex-1 min-w-0 text-sm font-semibold text-slate-800 truncate">{q.question.replace(/____/g, '___')}</span>
                <span className="hidden sm:inline-flex"><TypeBadge type={q.type} /></span>
                {resp?.flagged && <span className="text-[10px] font-bold text-amber-600">FLAGGED</span>}
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOpen && (
                <div className="px-5 pb-5 animate-fade-in">
                  {showsStem(q) && <p className="font-semibold text-slate-800 mb-3">{q.question}</p>}
                  <QuestionView question={q} value={answer} onChange={() => {}} reveal disabled />
                  {r && !r.correct && r.expected && <p className="mt-3 text-sm text-slate-700"><span className="font-bold text-emerald-700">Correct answer:</span> {r.expected}</p>}
                  {r?.feedback && <p className="mt-2 text-sm text-slate-600 italic">{r.feedback}</p>}
                  {q.explanation && <p className="mt-2 text-sm text-slate-600 leading-relaxed">{q.explanation}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <SourceChip question={q} onOpen={onOpenSource} />
                    {resp && <span className="text-[11px] text-slate-400">{Math.round(resp.time_ms / 1000)}s{resp.hints_used ? ' · used a hint' : ''}</span>}
                    <span className="flex-1" />
                    {r && !r.correct && (
                      <button onClick={() => onExplain(q, answer)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700">
                        <BookOpen className="w-3.5 h-3.5" /> Explain my mistake
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-center no-print">
        <button onClick={onNewQuiz} className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-slate-900 text-white font-bold btn-fill"><Plus className="w-4 h-4" /> New quiz</button>
      </div>
    </div>
  );
};
