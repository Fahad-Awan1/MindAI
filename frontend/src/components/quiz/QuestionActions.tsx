import React from 'react';
import { ArrowDownWideNarrow, Flame, Loader2, Pencil, RefreshCw, Trash2, X } from 'lucide-react';

interface QuestionActionsProps {
  /** 'rewrite' | 'easier' | 'harder' | 'delete' while that action runs */
  busy?: string;
  editing: boolean;
  onEdit: () => void;
  onRegenerate: (mode: 'same' | 'easier' | 'harder') => void;
  onDelete: () => void;
}

const btn = 'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors';

/** Edit / rewrite / easier / harder / delete for one question (quizzes and exam papers). */
export const QuestionActions: React.FC<QuestionActionsProps> = ({ busy, editing, onEdit, onRegenerate, onDelete }) => {
  if (busy) {
    return (
      <span className="flex items-center gap-1.5 text-xs font-semibold text-primary-600">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> {busy === 'delete' ? 'Deleting' : 'Rewriting'}…
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 font-sans no-print">
      <button type="button" onClick={onEdit} className={`${btn} ${editing ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600 hover:border-slate-400 hover:text-slate-900'}`}>
        {editing ? <X className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />} {editing ? 'Close' : 'Edit'}
      </button>
      <button type="button" onClick={() => onRegenerate('same')} title="Replace with a new question on the same idea" className={`${btn} border-slate-200 text-slate-600 hover:border-primary-300 hover:text-primary-700`}>
        <RefreshCw className="w-3.5 h-3.5" /> Rewrite
      </button>
      <button type="button" onClick={() => onRegenerate('easier')} title="Make it easier" className={`${btn} border-slate-200 text-slate-600 hover:border-emerald-300 hover:text-emerald-700`}>
        <ArrowDownWideNarrow className="w-3.5 h-3.5" /> Easier
      </button>
      <button type="button" onClick={() => onRegenerate('harder')} title="Make it harder" className={`${btn} border-slate-200 text-slate-600 hover:border-rose-300 hover:text-rose-700`}>
        <Flame className="w-3.5 h-3.5" /> Harder
      </button>
      <button type="button" onClick={() => window.confirm('Delete this question?') && onDelete()} title="Delete" className={`${btn} border-slate-200 text-slate-400 hover:border-rose-300 hover:text-rose-600`}>
        <Trash2 className="w-3.5 h-3.5" /> Delete
      </button>
    </div>
  );
};
