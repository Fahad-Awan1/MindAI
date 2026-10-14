import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, Flag, Heart, HelpCircle, Lightbulb, Loader2, LogOut, Scissors, Send, Timer, XCircle, Zap, Brain,
} from 'lucide-react';
import { AnswerValue, Difficulty, ItemResult, Question, ResponseItem } from '../../assessment/types';
import { answerText, emptyAnswer, gradeLocally, isBlankAnswer } from '../../assessment/grading';
import { seededShuffle } from '../../assessment/schema';
import { assessmentAPI, getErrorMessage } from '../../services/api';
import { Source } from '../../types';
import { PlayConfig } from './QuizEditor';
import { QuestionView, showsStem } from './QuestionView';
import { BloomBadge, DifficultyBadge, SourceChip, TypeBadge, formatDuration } from './bits';

interface QuizPlayerProps {
  setId: string;
  title: string;
  questions: Question[];
  config: PlayConfig;
  onFinish: (responses: ResponseItem[], durationMs: number, instant: Record<string, ItemResult>) => void;
  onExit: () => void;
  onOpenSource?: (source: Source) => void;
}

type Meta = Omit<ResponseItem, 'qid' | 'answer'>;
const blankMeta = (): Meta => ({ time_ms: 0, confidence: null, flagged: false, hints_used: 0, fifty_fifty: false });
const DIFFS: Difficulty[] = ['easy', 'medium', 'hard'];
const CONFIDENCE = [
  { value: 1 as const, label: 'Guessing' },
  { value: 2 as const, label: 'Unsure' },
  { value: 3 as const, label: 'Sure' },
];

export const QuizPlayer: React.FC<QuizPlayerProps> = ({ setId, title, questions, config, onFinish, onExit, onOpenSource }) => {
  const { mode } = config;
  const instant = mode === 'practice' || mode === 'survival' || mode === 'adaptive';
  const canNavigate = mode === 'test' || mode === 'review';

  // Order of play (adaptive picks the next question as it goes)
  const [sequence, setSequence] = useState<number[]>(() => {
    if (mode !== 'adaptive') return questions.map((_, i) => i);
    const first = questions.findIndex(q => q.difficulty === 'medium');
    return [first >= 0 ? first : 0];
  });
  const [pos, setPos] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [meta, setMeta] = useState<Record<string, Meta>>({});
  const [checked, setChecked] = useState<Record<string, ItemResult>>({});
  const [checking, setChecking] = useState(false);
  const [lives, setLives] = useState(config.lives);
  const [showHint, setShowHint] = useState<Record<string, boolean>>({});
  const [hidden, setHidden] = useState<Record<string, number[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const startedAt = useRef(Date.now());
  const shownAt = useRef(Date.now());
  const finished = useRef(false);

  const q = questions[sequence[pos]];
  const value = answers[q.id] ?? emptyAnswer(q);
  const result = checked[q.id];
  const m = meta[q.id] || blankMeta();
  const isLast = mode === 'adaptive' ? sequence.length >= questions.length : pos === sequence.length - 1;

  // Overall timer (test) / per-question timer (speed)
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!config.timeLimit) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [config.timeLimit]);
  const remaining = config.timeLimit
    ? mode === 'speed'
      ? config.timeLimit * 1000 - (now - shownAt.current)
      : config.timeLimit * 1000 - (now - startedAt.current)
    : null;

  const patchMeta = (qid: string, patch: Partial<Meta>) =>
    setMeta(prev => ({ ...prev, [qid]: { ...(prev[qid] || blankMeta()), ...patch } }));

  // Time spent on each question
  const recordTime = useCallback(() => {
    const spent = Date.now() - shownAt.current;
    shownAt.current = Date.now();
    setMeta(prev => ({ ...prev, [q.id]: { ...(prev[q.id] || blankMeta()), time_ms: (prev[q.id]?.time_ms || 0) + spent } }));
  }, [q.id]);

  const finish = useCallback((played?: number[]) => {
    if (finished.current) return;
    finished.current = true;
    const spent = Date.now() - shownAt.current;
    const ids = (played || (instant ? sequence.slice(0, pos + 1) : sequence)).map(i => questions[i].id);
    const responses: ResponseItem[] = ids.map(id => {
      const question = questions.find(x => x.id === id)!;
      const extra = id === q.id ? spent : 0;
      const mm = meta[id] || blankMeta();
      return { qid: id, answer: answers[id] ?? emptyAnswer(question), ...mm, time_ms: mm.time_ms + extra };
    });
    onFinish(responses, Date.now() - startedAt.current, checked);
  }, [answers, meta, checked, sequence, pos, questions, q.id, instant, onFinish]);

  // Time's up
  useEffect(() => {
    if (remaining === null || remaining > 0 || finished.current) return;
    if (mode === 'speed') {
      if (isLast) finish();
      else { recordTime(); setPos(p => p + 1); setNow(Date.now()); }
    } else {
      finish();
    }
  }, [remaining, mode, isLast, finish, recordTime]);

  const setAnswer = (v: AnswerValue) => {
    if (result) return;
    setAnswers(prev => ({ ...prev, [q.id]: v }));
  };

  const check = async () => {
    if (result || checking) return;
    const local = gradeLocally(q, value);
    let outcome: ItemResult = { qid: q.id, score: local.score, correct: local.correct, feedback: '', expected: answerText(q) };
    if (local.needsAi && !isBlankAnswer(value)) {
      setChecking(true);
      try {
        outcome = await assessmentAPI.check(setId, q.id, value);
      } catch (err) {
        setError(getErrorMessage(err, 'Could not check that answer.'));
      } finally {
        setChecking(false);
      }
    }
    setChecked(prev => ({ ...prev, [q.id]: outcome }));
    if (mode === 'survival' && !outcome.correct) setLives(l => l - 1);
  };

  const pickAdaptive = (): number | null => {
    const played = new Set(sequence);
    const remainingIdx = questions.map((_, i) => i).filter(i => !played.has(i));
    if (!remainingIdx.length) return null;
    // Two right in a row -> harder; a miss -> easier
    const recent = sequence.slice(-2).map(i => checked[questions[i].id]?.correct);
    const currentLevel = DIFFS.indexOf(q.difficulty || 'medium');
    const target = recent.length === 2 && recent.every(Boolean) ? Math.min(2, currentLevel + 1)
      : recent[recent.length - 1] === false ? Math.max(0, currentLevel - 1) : currentLevel;
    const byDistance = [...remainingIdx].sort((a, b) =>
      Math.abs(DIFFS.indexOf(questions[a].difficulty || 'medium') - target) - Math.abs(DIFFS.indexOf(questions[b].difficulty || 'medium') - target));
    return byDistance[0];
  };

  const next = () => {
    recordTime();
    setConfirmSubmit(false);
    if (mode === 'survival' && lives <= 0) return finish();
    if (mode === 'adaptive') {
      const n = pickAdaptive();
      if (n === null) return finish();
      setSequence(s => [...s, n]);
      setPos(p => p + 1);
      return;
    }
    if (isLast) return finish();
    setPos(p => p + 1);
  };

  const goto = (i: number) => {
    if (!canNavigate || i === pos) return;
    recordTime();
    setPos(i);
  };

  const submitAll = () => {
    const unanswered = sequence.filter(i => isBlankAnswer(answers[questions[i].id] ?? null)).length;
    if (unanswered && !confirmSubmit) {
      setConfirmSubmit(true);
      return;
    }
    recordTime();
    finish();
  };

  const useFifty = () => {
    if (q.type !== 'mcq' || !q.options || hidden[q.id] || result) return;
    const wrong = q.options.map((_, i) => i).filter(i => i !== q.correct_answer_index);
    setHidden(prev => ({ ...prev, [q.id]: seededShuffle(wrong, q.id).slice(0, Math.max(0, q.options!.length - 2)) }));
    patchMeta(q.id, { fifty_fifty: true });
  };

  const useHint = () => {
    if (!q.hint || showHint[q.id]) return;
    setShowHint(prev => ({ ...prev, [q.id]: true }));
    patchMeta(q.id, { hints_used: (m.hints_used || 0) + 1 });
  };

  // Keyboard: Enter = check / next, F = flag, H = hint, arrows = navigate
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable]');
      if (e.key === 'Enter' && !e.shiftKey && !(typing && (e.target as HTMLElement).tagName === 'TEXTAREA')) {
        e.preventDefault();
        if (instant && !result) check();
        else if (canNavigate && isLast) submitAll();
        else next();
        return;
      }
      if (typing) return;
      if (e.key === 'f' || e.key === 'F') patchMeta(q.id, { flagged: !m.flagged });
      if (e.key === 'h' || e.key === 'H') useHint();
      if (canNavigate && e.key === 'ArrowRight' && pos < sequence.length - 1) goto(pos + 1);
      if (canNavigate && e.key === 'ArrowLeft' && pos > 0) goto(pos - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const answeredCount = useMemo(() => sequence.filter(i => !isBlankAnswer(answers[questions[i].id] ?? null)).length, [answers, sequence, questions]);
  const total = mode === 'adaptive' || mode === 'survival' ? questions.length : sequence.length;
  const progress = Math.round(((mode === 'adaptive' || mode === 'survival' ? pos + (result ? 1 : 0) : answeredCount) / total) * 100);
  const lowTime = remaining !== null && remaining < (mode === 'speed' ? 5000 : 60000);
  const streak = (() => {
    let s = 0;
    for (let i = pos; i >= 0; i--) {
      if (checked[questions[sequence[i]].id]?.correct) s++;
      else if (checked[questions[sequence[i]].id]) break;
    }
    return s;
  })();

  return (
    <div className="max-w-5xl mx-auto">
      {/* Top bar */}
      <div className="sticky top-3 z-20 mb-5 flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/85 backdrop-blur-xl border border-slate-200/70 shadow-lg shadow-slate-900/5 animate-slide-up">
        <button onClick={() => window.confirm('Leave this quiz? Your answers so far won\'t be saved.') && onExit()} className="p-2 -ml-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label="Leave quiz"><LogOut className="w-4 h-4" /></button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-slate-800 truncate">{title}</p>
          <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-gradient-to-r from-primary-500 to-indigo-500 transition-all duration-700 ease-out-expo" style={{ width: `${progress}%` }} />
          </div>
        </div>
        {mode === 'survival' && (
          <div className="flex items-center gap-0.5" aria-label={`${lives} lives left`}>
            {Array.from({ length: config.lives }).map((_, i) => (
              <Heart key={i} className={`w-5 h-5 transition-all duration-500 ${i < lives ? 'text-rose-500 fill-rose-500' : 'text-slate-200 scale-75'}`} />
            ))}
          </div>
        )}
        {streak >= 2 && <span className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-bold animate-pop"><Zap className="w-3.5 h-3.5" /> {streak} streak</span>}
        {mode === 'adaptive' && <span className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-full bg-fuchsia-50 text-fuchsia-700 text-xs font-bold"><Brain className="w-3.5 h-3.5" /> Level: {q.difficulty || 'medium'}</span>}
        {remaining !== null && (
          <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono text-sm font-bold tabular-nums transition-colors ${lowTime ? 'bg-rose-100 text-rose-700 animate-pulse' : 'bg-slate-100 text-slate-700'}`}>
            <Timer className="w-4 h-4" /> {formatDuration(Math.max(0, remaining))}
          </span>
        )}
        <span className="text-sm font-bold text-slate-500 tabular-nums">{pos + 1}<span className="text-slate-300">/{total}</span></span>
      </div>

      <div className={`grid gap-5 ${canNavigate ? 'lg:grid-cols-[1fr_220px]' : ''}`}>
        {/* Card */}
        <div key={q.id} className="card-deal">
          <div className={`relative bg-white rounded-[1.75rem] border shadow-xl shadow-slate-900/5 p-6 md:p-8 transition-colors duration-500
            ${result ? (result.correct ? 'border-emerald-200' : result.score > 0 ? 'border-amber-200' : 'border-rose-200') : 'border-slate-100'}`}>
            <div className="flex flex-wrap items-center gap-1.5 mb-4">
              <TypeBadge type={q.type} /><DifficultyBadge difficulty={q.difficulty} /><BloomBadge bloom={q.bloom} />
              {q.topic && <span className="text-xs text-slate-400 ml-1">{q.topic}</span>}
              <span className="flex-1" />
              <button onClick={() => patchMeta(q.id, { flagged: !m.flagged })} className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold transition-colors ${m.flagged ? 'bg-amber-100 text-amber-700' : 'text-slate-400 hover:bg-slate-100'}`} title="Flag for review (F)">
                <Flag className={`w-3.5 h-3.5 ${m.flagged ? 'fill-current' : ''}`} /> {m.flagged ? 'Flagged' : 'Flag'}
              </button>
            </div>

            {showsStem(q) && <h2 className="text-xl md:text-2xl font-display font-bold text-slate-900 leading-snug mb-6">{q.question}</h2>}
            {!showsStem(q) && <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Fill in the blank{(q.blanks?.length || 0) > 1 ? 's' : ''}</p>}

            <QuestionView question={q} value={value} onChange={setAnswer} reveal={!!result} disabled={!!result || checking} hiddenOptions={hidden[q.id]} keyboard />

            {/* Hint */}
            {showHint[q.id] && q.hint && !result && (
              <p className="mt-4 flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-100 text-sm text-amber-900 animate-slide-up"><Lightbulb className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-500" /> {q.hint}</p>
            )}

            {/* Instant feedback */}
            {result && (
              <div className={`mt-5 p-4 rounded-2xl border animate-slide-up ${result.correct ? 'bg-emerald-50 border-emerald-100' : result.score > 0 ? 'bg-amber-50 border-amber-100' : 'bg-rose-50 border-rose-100'}`}>
                <p className={`font-bold flex items-center gap-2 ${result.correct ? 'text-emerald-800' : result.score > 0 ? 'text-amber-800' : 'text-rose-800'}`}>
                  {result.correct ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                  {result.correct ? 'Correct!' : result.score > 0 ? `Partly right (${Math.round(result.score * 100)}%)` : 'Not quite'}
                  {mode === 'survival' && !result.correct && <span className="ml-auto flex items-center gap-1 text-rose-600 text-sm"><Heart className="w-4 h-4" /> -1 life</span>}
                </p>
                {!result.correct && result.expected && <p className="text-sm text-slate-700 mt-1.5"><span className="font-semibold">Answer:</span> {result.expected}</p>}
                {result.feedback && <p className="text-sm text-slate-700 mt-1.5">{result.feedback}</p>}
                {q.explanation && <p className="text-sm text-slate-600 mt-2 leading-relaxed">{q.explanation}</p>}
                <div className="mt-2"><SourceChip question={q} onOpen={onOpenSource} /></div>
              </div>
            )}

            {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}

            {/* Tools + confidence */}
            {!result && (
              <div className="mt-6 flex flex-wrap items-center gap-2">
                {q.hint && <button onClick={useHint} disabled={!!showHint[q.id]} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-500 hover:border-amber-300 hover:text-amber-700 disabled:opacity-40" title="Hint (H)"><HelpCircle className="w-3.5 h-3.5" /> Hint</button>}
                {q.type === 'mcq' && mode !== 'test' && <button onClick={useFifty} disabled={!!hidden[q.id]} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-500 hover:border-violet-300 hover:text-violet-700 disabled:opacity-40"><Scissors className="w-3.5 h-3.5" /> 50 / 50</button>}
                <span className="flex-1" />
                <span className="text-[11px] font-semibold text-slate-400 mr-1">How sure are you?</span>
                {CONFIDENCE.map(c => (
                  <button key={c.value} onClick={() => patchMeta(q.id, { confidence: m.confidence === c.value ? null : c.value })}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${m.confidence === c.value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>{c.label}</button>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="mt-6 flex items-center gap-3">
              {canNavigate && <button onClick={() => goto(pos - 1)} disabled={pos === 0} className="flex items-center gap-1.5 px-4 py-3 rounded-2xl border border-slate-200 font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-30"><ArrowLeft className="w-4 h-4" /> Back</button>}
              <span className="flex-1" />
              {instant && !result ? (
                <button onClick={check} disabled={checking || isBlankAnswer(value)} className="btn-shine flex items-center gap-2 px-6 py-3 rounded-2xl bg-slate-900 text-white font-bold disabled:opacity-40">
                  {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Check
                </button>
              ) : canNavigate && isLast ? (
                <button onClick={submitAll} className="btn-shine flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-primary-600 to-indigo-600 text-white font-bold shadow-lg shadow-primary-500/30">
                  <Send className="w-4 h-4" /> {confirmSubmit ? 'Submit anyway' : 'Submit'}
                </button>
              ) : (
                <button onClick={next} className="btn-shine flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-primary-600 to-indigo-600 text-white font-bold shadow-lg shadow-primary-500/30">
                  {(mode === 'survival' && lives <= 0) || (isLast && !canNavigate) ? 'See results' : 'Next'} <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
            {confirmSubmit && <p className="mt-3 text-sm text-amber-700 text-right animate-fade-in">{sequence.length - answeredCount} question{sequence.length - answeredCount === 1 ? ' is' : 's are'} unanswered. Press Submit again to finish anyway.</p>}
          </div>
          <p className="hidden md:block text-center text-[11px] text-slate-400 mt-3">
            <kbd className="font-sans font-semibold">1–6</kbd> choose · <kbd className="font-sans font-semibold">Enter</kbd> {instant ? 'check / next' : 'next'} · <kbd className="font-sans font-semibold">F</kbd> flag · <kbd className="font-sans font-semibold">H</kbd> hint{canNavigate ? ' · ← → move' : ''}
          </p>
        </div>

        {/* Navigator */}
        {canNavigate && (
          <aside className="hidden lg:block">
            <div className="sticky top-24 bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 mb-3">Questions</p>
              <div className="grid grid-cols-5 gap-1.5">
                {sequence.map((qi, i) => {
                  const id = questions[qi].id;
                  const answered = !isBlankAnswer(answers[id] ?? null);
                  const flagged = meta[id]?.flagged;
                  return (
                    <button key={id} onClick={() => goto(i)}
                      className={`relative h-9 rounded-lg text-xs font-bold transition-all duration-300 ${i === pos ? 'bg-slate-900 text-white scale-110 shadow-md' : answered ? 'bg-primary-100 text-primary-700' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}>
                      {i + 1}
                      {flagged && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 ring-2 ring-white" />}
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 space-y-1 text-[11px] text-slate-500">
                <p className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-primary-100" /> Answered ({answeredCount})</p>
                <p className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-amber-400" /> Flagged ({Object.values(meta).filter(x => x.flagged).length})</p>
              </div>
              <button onClick={submitAll} className="mt-4 w-full py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold btn-fill">Submit quiz</button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};
