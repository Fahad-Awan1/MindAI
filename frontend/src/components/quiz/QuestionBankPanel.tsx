import React, { useEffect, useState } from 'react';
import { Archive, CalendarCheck, Dices, Loader2, RotateCcw, Target, Zap } from 'lucide-react';
import { bankAPI, BankSummary, getErrorMessage } from '../../services/api';
import { StudySet } from '../../types';
import { CountUp } from '../../motion';

interface QuestionBankPanelProps {
  documentId?: string;
  onOpen: (set: StudySet<unknown>) => void;
}

type Source = 'due' | 'missed' | 'weak' | 'random';

/** Every question you've generated is kept here: instant quizzes, no waiting for the AI. */
export const QuestionBankPanel: React.FC<QuestionBankPanelProps> = ({ documentId, onOpen }) => {
  const [scope, setScope] = useState<'all' | 'doc'>('all');
  const [summary, setSummary] = useState<BankSummary | null>(null);
  const [busy, setBusy] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);
  const docFilter = scope === 'doc' ? documentId : undefined;

  useEffect(() => {
    let cancelled = false;
    bankAPI.summary(docFilter).then(s => { if (!cancelled) setSummary(s); }).catch(() => {});
    return () => { cancelled = true; };
  }, [docFilter]);

  if (!summary || summary.total === 0) return null;

  const start = async (source: Source) => {
    setBusy(source);
    setError(null);
    try {
      onOpen(await bankAPI.quiz(source, 10, source === 'weak' ? documentId : docFilter));
    } catch (err) {
      setError(getErrorMessage(err, 'Could not build that quiz.'));
    } finally {
      setBusy(null);
    }
  };

  const actions: { source: Source; label: string; count: number | null; icon: React.ElementType; tone: string; hint: string }[] = [
    { source: 'due', label: 'Review due', count: summary.due, icon: CalendarCheck, tone: 'from-emerald-500 to-teal-500', hint: 'Spaced re-testing of what you missed' },
    { source: 'missed', label: 'Retry missed', count: summary.missed, icon: RotateCcw, tone: 'from-rose-500 to-orange-500', hint: 'Questions you got wrong last time' },
    { source: 'weak', label: 'Weak topics', count: null, icon: Target, tone: 'from-violet-500 to-fuchsia-500', hint: 'Your lowest-scoring topics' },
    { source: 'random', label: 'Shuffle 10', count: summary.quizzable, icon: Dices, tone: 'from-sky-500 to-indigo-500', hint: 'A random mix from the bank' },
  ];

  return (
    <div className="w-full max-w-2xl mt-8 text-left bg-white rounded-3xl shadow-sm border border-slate-100 p-6 animate-rise" style={{ animationDelay: '500ms', animationFillMode: 'backwards' }}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><Archive className="w-4 h-4 text-slate-400" /> Question bank</h3>
          <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1"><Zap className="w-3 h-3 text-amber-500" /> Instant quizzes from questions you've already generated - no AI wait.</p>
        </div>
        {documentId && (
          <div className="flex bg-slate-100 rounded-lg p-0.5 text-xs font-semibold">
            {(['all', 'doc'] as const).map(s => (
              <button key={s} onClick={() => setScope(s)} className={`px-2.5 py-1 rounded-md ${scope === s ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{s === 'all' ? 'All documents' : 'This document'}</button>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4 text-center">
        <div className="rounded-2xl bg-slate-50 p-3"><p className="text-2xl font-display font-bold text-slate-900"><CountUp value={summary.total} /></p><p className="text-[11px] text-slate-500 font-semibold">questions</p></div>
        <div className="rounded-2xl bg-slate-50 p-3"><p className="text-2xl font-display font-bold text-slate-900"><CountUp value={summary.answered} /></p><p className="text-[11px] text-slate-500 font-semibold">answered</p></div>
        <div className="rounded-2xl bg-emerald-50 p-3"><p className="text-2xl font-display font-bold text-emerald-700"><CountUp value={summary.mastered} /></p><p className="text-[11px] text-emerald-700/80 font-semibold">mastered</p></div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {actions.map(a => (
          <button key={a.source} onClick={() => start(a.source)} disabled={!!busy || a.count === 0} title={a.hint}
            className="lift group relative p-3 rounded-2xl border border-slate-100 bg-white text-left disabled:opacity-40 disabled:hover:transform-none">
            <span className={`w-8 h-8 rounded-xl bg-gradient-to-br ${a.tone} text-white flex items-center justify-center mb-2 shadow-sm`}>
              {busy === a.source ? <Loader2 className="w-4 h-4 animate-spin" /> : <a.icon className="w-4 h-4" />}
            </span>
            <span className="block text-sm font-bold text-slate-800">{a.label}</span>
            {a.count !== null && <span className="text-[11px] text-slate-500">{a.count} question{a.count === 1 ? '' : 's'}</span>}
          </button>
        ))}
      </div>
      {summary.topics.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {summary.topics.slice(0, 10).map(t => (
            <span key={t.topic} className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-100 text-[11px] font-semibold text-slate-600">
              {t.topic} {t.accuracy_pct !== null && <span className={t.accuracy_pct >= 70 ? 'text-emerald-600' : 'text-rose-500'}>{t.accuracy_pct}%</span>}
            </span>
          ))}
        </div>
      )}
      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
    </div>
  );
};
