import React, { useEffect, useState } from 'react';
import { StudySetKind, StudySetSummary } from '../types';
import { studySetsAPI, getErrorMessage } from '../services/api';
import { Tooltip } from './Tooltip';
import { History, Trash2, ChevronRight, Loader2, Trophy } from 'lucide-react';

interface SavedSetsProps {
  kind: StudySetKind;
  /** Selected document; sets for other documents are shown when "All documents" is toggled */
  documentId?: string;
  onOpen: (set: StudySetSummary) => void;
  /** Accent classes for the open button, to match each screen's color */
  accent?: string;
}

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

export const SavedSets: React.FC<SavedSetsProps> = ({ kind, documentId, onOpen, accent = 'text-indigo-600 hover:bg-indigo-50' }) => {
  const [sets, setSets] = useState<StudySetSummary[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    studySetsAPI.list({ kind, documentId: showAll ? undefined : documentId })
      .then(result => { if (!cancelled) setSets(result); })
      .catch(err => { if (!cancelled) setError(getErrorMessage(err, 'Failed to load saved sets.')); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [kind, documentId, showAll]);

  const handleDelete = async (set: StudySetSummary) => {
    if (!window.confirm(`Delete "${set.title}"? Its attempt history will be removed too.`)) return;
    try {
      await studySetsAPI.delete(set.id);
      setSets(prev => prev.filter(s => s.id !== set.id));
    } catch (err) {
      alert(getErrorMessage(err, 'Failed to delete the study set.'));
    }
  };

  const describeProgress = (set: StudySetSummary) => {
    if (set.attempts === 0) return null;
    if (kind === 'quiz') return `Best ${set.best_score_pct}% · ${set.attempts} attempt${set.attempts === 1 ? '' : 's'}`;
    if (kind === 'teach_back') return `Score ${set.last_score_pct}/100`;
    if (kind === 'study_group') return `Participation ${set.last_score_pct}/100`;
    if (kind === 'exam') return `Best ${set.best_score_pct}% · ${set.attempts} marked attempt${set.attempts === 1 ? '' : 's'}`;
    if (kind === 'flashcards') return `Last review ${set.last_score_pct}% known · ${set.attempts} session${set.attempts === 1 ? '' : 's'}`;
    return null;
  };

  return (
    <div className="w-full max-w-2xl mt-10 text-left animate-rise" style={{ animationDelay: "550ms", animationFillMode: "backwards" }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-700 uppercase tracking-wide">
          <History className="w-4 h-4 text-slate-400" />
          Saved
        </h3>
        <label className="flex items-center gap-2 text-xs font-medium text-slate-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showAll}
            onChange={() => setShowAll(v => !v)}
            className="rounded border-slate-300"
          />
          All documents
        </label>
      </div>

      <div className="spotlight bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : error ? (
          <p className="p-4 text-sm text-red-500">{error}</p>
        ) : sets.length === 0 ? (
          <p className="p-5 text-sm text-slate-400 text-center">Nothing saved yet. Everything you generate is saved here automatically.</p>
        ) : (
          <ul className="divide-y divide-slate-50 max-h-80 overflow-y-auto stagger" data-lenis-prevent>
            {sets.map(set => {
              const progress = describeProgress(set);
              return (
                <li key={set.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/80 transition-colors duration-300 group">
                  <button onClick={() => onOpen(set)} className="flex-1 min-w-0 text-left">
                    <p className="font-semibold text-slate-800 truncate transition-transform duration-500 ease-out-expo group-hover:translate-x-1">{set.title}</p>
                    <p className="text-xs text-slate-400 truncate">
                      {showAll && <span className="text-slate-500">{set.document_title} · </span>}
                      {formatDate(set.created_at)}
                      {progress && (
                        <span className="inline-flex items-center gap-1 ml-2 text-slate-500">
                          <Trophy className="w-3 h-3 text-amber-400" />
                          {progress}
                        </span>
                      )}
                    </p>
                  </button>
                  <Tooltip content="Delete" position="left">
                    <button
                      onClick={() => handleDelete(set)}
                      className="p-2 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all"
                      aria-label={`Delete ${set.title}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </Tooltip>
                  <button
                    onClick={() => onOpen(set)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${accent}`}
                  >
                    Open <ChevronRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};
