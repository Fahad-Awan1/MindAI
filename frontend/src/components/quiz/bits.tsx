import React from 'react';
import { BookOpen } from 'lucide-react';
import { BLOOM_LABELS, Bloom, Difficulty, Question, QuestionType, TYPE_LABELS } from '../../assessment/types';
import { Source } from '../../types';

const DIFFICULTY_STYLE: Record<Difficulty, string> = {
  easy: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  medium: 'bg-amber-50 text-amber-700 ring-amber-200',
  hard: 'bg-rose-50 text-rose-700 ring-rose-200',
};

const TYPE_STYLE: Partial<Record<QuestionType, string>> = {
  mcq: 'bg-indigo-50 text-indigo-700',
  multi_select: 'bg-violet-50 text-violet-700',
  true_false: 'bg-sky-50 text-sky-700',
  fill_blank: 'bg-teal-50 text-teal-700',
  matching: 'bg-fuchsia-50 text-fuchsia-700',
  ordering: 'bg-orange-50 text-orange-700',
  numeric: 'bg-cyan-50 text-cyan-700',
  short_answer: 'bg-pink-50 text-pink-700',
  short: 'bg-pink-50 text-pink-700',
  long: 'bg-purple-50 text-purple-700',
};

export const TypeBadge: React.FC<{ type: QuestionType }> = ({ type }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-bold uppercase tracking-wide ${TYPE_STYLE[type] || 'bg-slate-100 text-slate-600'}`}>
    {TYPE_LABELS[type] || type}
  </span>
);

export const DifficultyBadge: React.FC<{ difficulty?: Difficulty }> = ({ difficulty }) =>
  difficulty ? (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-bold uppercase tracking-wide ring-1 ${DIFFICULTY_STYLE[difficulty]}`}>
      {difficulty}
    </span>
  ) : null;

export const BloomBadge: React.FC<{ bloom?: Bloom }> = ({ bloom }) =>
  bloom ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10.5px] font-semibold text-slate-500 bg-slate-100" title="Thinking level (Bloom's taxonomy)">
      {BLOOM_LABELS[bloom]}
    </span>
  ) : null;

export const toSource = (q: Question, n = 1): Source | null =>
  q.source ? { n, document_id: q.source.document_id, document_title: q.source.document_title, location: q.source.location, text: q.source.text } : null;

/** "Biology.pdf · Page 12" - opens the cited passage. */
export const SourceChip: React.FC<{ question: Question; onOpen?: (source: Source) => void; className?: string }> = ({ question, onOpen, className = '' }) => {
  const source = toSource(question);
  if (!source) return null;
  const label = [source.document_title, source.location].filter(Boolean).join(' · ') || 'Source';
  return (
    <button
      type="button"
      onClick={() => onOpen?.(source)}
      disabled={!onOpen}
      data-cursor="Source"
      className={`inline-flex items-center gap-1.5 max-w-[18rem] px-2 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-medium text-slate-500 hover:border-indigo-300 hover:text-indigo-700 transition-colors ${className}`}
      title="See where this comes from"
    >
      <BookOpen className="w-3 h-3 flex-shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
};

export const formatDuration = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};
