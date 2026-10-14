import React, { useEffect, useMemo } from 'react';
import { ArrowDown, ArrowUp, Check, X, Link2, Unlink } from 'lucide-react';
import { AnswerValue, Question } from '../../assessment/types';
import { seededShuffle } from '../../assessment/schema';

export interface Reveal {
  /** Show what was right/wrong */
  show: boolean;
}

interface QuestionViewProps {
  question: Question;
  value: AnswerValue;
  onChange: (value: AnswerValue) => void;
  reveal?: boolean;
  disabled?: boolean;
  /** Option indices hidden by the 50/50 lifeline */
  hiddenOptions?: number[];
  /** Number keys select options (only the active card) */
  keyboard?: boolean;
}

const letter = (i: number) => String.fromCharCode(65 + i);
const BLANK = '____';

const optionClass = (selected: boolean, state: 'right' | 'wrong' | 'missed' | null, disabled: boolean) => {
  if (state === 'right') return 'border-emerald-400 bg-emerald-50 text-emerald-900';
  if (state === 'wrong') return 'border-rose-300 bg-rose-50 text-rose-900';
  if (state === 'missed') return 'border-emerald-300 border-dashed bg-emerald-50/40 text-emerald-800';
  if (selected) return 'border-primary-500 bg-primary-50 text-primary-900 shadow-md shadow-primary-500/10 scale-[1.01]';
  return `border-slate-200 bg-white text-slate-700 ${disabled ? '' : 'hover:border-primary-300 hover:bg-primary-50/30 hover:translate-x-1'}`;
};

/** Multiple choice, true/false and select-all options. */
const ChoiceView: React.FC<QuestionViewProps & { multi: boolean }> = ({ question, value, onChange, reveal, disabled, hiddenOptions = [], keyboard, multi }) => {
  const options = question.options || [];
  const selected: number[] = multi ? ((value as number[]) || []) : (typeof value === 'number' && value >= 0 ? [value] : []);
  const correct = multi ? (question.correct_indices || []) : [question.correct_answer_index ?? -1];

  const toggle = (i: number) => {
    if (disabled || hiddenOptions.includes(i)) return;
    if (multi) onChange(selected.includes(i) ? selected.filter(x => x !== i) : [...selected, i].sort((a, b) => a - b));
    else onChange(i);
  };

  useEffect(() => {
    if (!keyboard || disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable]')) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= options.length) {
        e.preventDefault();
        toggle(n - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="space-y-2.5" role={multi ? 'group' : 'radiogroup'}>
      {multi && !reveal && <p className="text-xs font-semibold text-slate-400">Select every correct option</p>}
      {options.map((opt, i) => {
        const hidden = hiddenOptions.includes(i);
        const isSel = selected.includes(i);
        const isCorrect = correct.includes(i);
        const state = reveal ? (isCorrect ? (isSel ? 'right' : 'missed') : isSel ? 'wrong' : null) : null;
        return (
          <button
            key={i}
            type="button"
            role={multi ? 'checkbox' : 'radio'}
            aria-checked={isSel}
            onClick={() => toggle(i)}
            disabled={disabled || hidden}
            className={`group/opt w-full text-left px-4 py-3.5 rounded-2xl border-2 transition-all duration-300 ease-out-expo flex items-center gap-3 font-medium
              ${hidden ? 'opacity-25 line-through pointer-events-none' : ''} ${optionClass(isSel, state, !!disabled)}`}
          >
            <span className={`w-8 h-8 rounded-${multi ? 'lg' : 'full'} flex items-center justify-center text-xs font-bold flex-shrink-0 border-2 transition-colors
              ${isSel ? 'bg-primary-600 border-primary-600 text-white' : 'border-slate-200 text-slate-400 group-hover/opt:border-primary-300'}`}>
              {multi ? (isSel ? <Check className="w-4 h-4" /> : letter(i)) : letter(i)}
            </span>
            <span className="flex-1">{opt}</span>
            {state === 'right' && <Check className="w-5 h-5 text-emerald-600 animate-pop" />}
            {state === 'wrong' && <X className="w-5 h-5 text-rose-500 animate-pop" />}
            {state === 'missed' && <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">Missed</span>}
          </button>
        );
      })}
    </div>
  );
};

const FillBlankView: React.FC<QuestionViewProps> = ({ question, value, onChange, reveal, disabled }) => {
  const parts = question.question.split(BLANK);
  const answers = (value as string[]) || [];
  const blanks = question.blanks || [];
  return (
    <div className="text-lg leading-[2.6rem] text-slate-800 font-medium">
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          <span>{part}</span>
          {i < blanks.length && (
            <span className="inline-flex flex-col align-middle mx-1">
              <input
                value={answers[i] ?? ''}
                onChange={e => {
                  const next = [...answers];
                  while (next.length < blanks.length) next.push('');
                  next[i] = e.target.value;
                  onChange(next);
                }}
                disabled={disabled}
                aria-label={`Blank ${i + 1}`}
                className={`inline-block w-44 px-3 py-1 rounded-xl border-2 text-base font-semibold text-center transition-colors focus:outline-none focus:ring-4
                  ${reveal
                    ? (blanks[i].accepted.some(a => a.trim().toLowerCase() === (answers[i] || '').trim().toLowerCase()) ? 'border-emerald-400 bg-emerald-50' : 'border-rose-300 bg-rose-50')
                    : 'border-primary-200 bg-primary-50/40 focus:border-primary-500 focus:ring-primary-100'}`}
              />
              {reveal && <span className="text-xs font-bold text-emerald-700 text-center leading-5">{blanks[i].accepted[0]}</span>}
            </span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

const RIGHT_COLORS = ['bg-violet-500', 'bg-sky-500', 'bg-amber-500', 'bg-emerald-500', 'bg-rose-500', 'bg-indigo-500'];

/** Click a term, then click its match. Pairs get matching colours. */
const MatchingView: React.FC<QuestionViewProps> = ({ question, value, onChange, reveal, disabled }) => {
  const left = question.left || [];
  const right = question.right || [];
  const chosen: number[] = (value as number[]) || left.map(() => -1);
  const [active, setActive] = React.useState<number | null>(null);
  const truth = new Map((question.pairs || []).map(([l, r]) => [l, r]));

  const pick = (ri: number) => {
    if (disabled || active === null) return;
    const next = chosen.map(v => (v === ri ? -1 : v));
    next[active] = ri;
    onChange(next);
    const nextEmpty = next.findIndex(v => v === -1);
    setActive(nextEmpty >= 0 ? nextEmpty : null);
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
      <div className="space-y-2.5">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Terms</p>
        {left.map((item, li) => {
          const ri = chosen[li];
          const ok = reveal ? truth.get(li) === ri : null;
          return (
            <button
              key={li}
              type="button"
              onClick={() => !disabled && setActive(active === li ? null : li)}
              disabled={disabled}
              className={`w-full flex items-center gap-3 text-left px-4 py-3 rounded-2xl border-2 font-medium transition-all duration-300
                ${active === li ? 'border-primary-500 bg-primary-50 shadow-md' : ok === true ? 'border-emerald-400 bg-emerald-50' : ok === false ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-white hover:border-primary-300'}`}
            >
              <span className={`w-3 h-3 rounded-full flex-shrink-0 ${ri >= 0 ? RIGHT_COLORS[ri % RIGHT_COLORS.length] : 'bg-slate-200'}`} />
              <span className="flex-1">{item}</span>
              {ri >= 0 && !reveal && (
                <span onClick={e => { e.stopPropagation(); const next = [...chosen]; next[li] = -1; onChange(next); }} className="p-1 rounded-md text-slate-300 hover:text-rose-500" title="Unlink">
                  <Unlink className="w-3.5 h-3.5" />
                </span>
              )}
              {reveal && ok === false && <span className="text-xs font-semibold text-emerald-700">→ {right[truth.get(li) ?? 0]}</span>}
            </button>
          );
        })}
      </div>
      <div className="space-y-2.5">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 flex items-center gap-1.5">
          Matches {active !== null && !disabled && <span className="text-primary-600 normal-case tracking-normal font-semibold flex items-center gap-1"><Link2 className="w-3 h-3" /> pick a match for “{left[active]}”</span>}
        </p>
        {right.map((item, ri) => {
          const usedBy = chosen.indexOf(ri);
          return (
            <button
              key={ri}
              type="button"
              onClick={() => pick(ri)}
              disabled={disabled || active === null}
              className={`w-full flex items-center gap-3 text-left px-4 py-3 rounded-2xl border-2 font-medium transition-all duration-300
                ${usedBy >= 0 ? 'border-slate-300 bg-slate-50' : 'border-slate-200 bg-white'} ${active !== null && !disabled ? 'hover:border-primary-400 hover:-translate-y-0.5 cursor-pointer' : ''}`}
            >
              <span className={`w-3 h-3 rounded-full flex-shrink-0 ${RIGHT_COLORS[ri % RIGHT_COLORS.length]} ${usedBy >= 0 ? '' : 'opacity-30'}`} />
              <span className="flex-1">{item}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

/** Reorder with the arrow buttons (or Alt+Arrow keys on a focused item). */
const OrderingView: React.FC<QuestionViewProps> = ({ question, value, onChange, reveal, disabled }) => {
  const items = question.items || [];
  const initial = useMemo(() => {
    let order = seededShuffle(items.map((_, i) => i), question.id);
    if (order.every((v, i) => v === i) && order.length > 1) order = [...order.slice(1), order[0]];
    return order;
  }, [question.id, items.length]);
  const order: number[] = Array.isArray(value) && value.length === items.length ? (value as number[]) : initial;

  useEffect(() => {
    if (!Array.isArray(value) || value.length !== items.length) onChange(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  const move = (pos: number, delta: number) => {
    const to = pos + delta;
    if (disabled || to < 0 || to >= order.length) return;
    const next = [...order];
    [next[pos], next[to]] = [next[to], next[pos]];
    onChange(next);
  };

  return (
    <ol className="space-y-2.5">
      {order.map((itemIndex, pos) => {
        const ok = reveal ? itemIndex === pos : null;
        return (
          <li
            key={itemIndex}
            tabIndex={disabled ? -1 : 0}
            onKeyDown={e => {
              if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); move(pos, -1); }
              if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); move(pos, 1); }
            }}
            className={`flex items-center gap-3 px-4 py-3 rounded-2xl border-2 bg-white font-medium transition-all duration-500 ease-out-expo focus:outline-none focus:ring-4 focus:ring-primary-100
              ${ok === true ? 'border-emerald-400 bg-emerald-50' : ok === false ? 'border-rose-300 bg-rose-50' : 'border-slate-200'}`}
          >
            <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 text-xs font-bold flex items-center justify-center flex-shrink-0">{pos + 1}</span>
            <span className="flex-1">{items[itemIndex]}</span>
            {reveal && ok === false && <span className="text-xs font-semibold text-emerald-700">should be #{itemIndex + 1}</span>}
            {!disabled && (
              <span className="flex flex-col">
                <button type="button" onClick={() => move(pos, -1)} disabled={pos === 0} className="p-0.5 rounded text-slate-400 hover:text-primary-600 disabled:opacity-20" aria-label="Move up"><ArrowUp className="w-4 h-4" /></button>
                <button type="button" onClick={() => move(pos, 1)} disabled={pos === order.length - 1} className="p-0.5 rounded text-slate-400 hover:text-primary-600 disabled:opacity-20" aria-label="Move down"><ArrowDown className="w-4 h-4" /></button>
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
};

const TextAnswerView: React.FC<QuestionViewProps & { multiline: boolean; placeholder: string; suffix?: string }> = ({ value, onChange, disabled, multiline, placeholder, suffix }) => (
  <div className="relative">
    {multiline ? (
      <textarea
        value={(value as string) ?? ''}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        rows={4}
        maxLength={3000}
        placeholder={placeholder}
        className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-[15px] leading-relaxed focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-100 transition-colors"
      />
    ) : (
      <div className="flex items-center gap-3">
        <input
          value={(value as string) ?? ''}
          onChange={e => onChange(e.target.value)}
          disabled={disabled}
          inputMode="decimal"
          placeholder={placeholder}
          className="w-56 rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-lg font-semibold focus:outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-100 transition-colors"
        />
        {suffix && <span className="text-slate-500 font-semibold">{suffix}</span>}
      </div>
    )}
  </div>
);

/** Renders the answer area for any question type. */
export const QuestionView: React.FC<QuestionViewProps> = props => {
  const { question } = props;
  switch (question.type) {
    case 'mcq':
    case 'true_false':
      return <ChoiceView {...props} multi={false} />;
    case 'multi_select':
      return <ChoiceView {...props} multi />;
    case 'fill_blank':
      return <FillBlankView {...props} />;
    case 'matching':
      return <MatchingView {...props} />;
    case 'ordering':
      return <OrderingView {...props} />;
    case 'numeric':
      return <TextAnswerView {...props} multiline={false} placeholder="Your answer" suffix={question.unit || undefined} />;
    default:
      return <TextAnswerView {...props} multiline placeholder="Write your answer in a sentence or two…" />;
  }
};

/** The question stem (fill-in-the-blank questions show their blanks inline instead). */
export const showsStem = (q: Question) => q.type !== 'fill_blank';
