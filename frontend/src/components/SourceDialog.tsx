import React, { useEffect } from 'react';
import { Source } from '../types';
import { BookOpen, FileText, X } from 'lucide-react';

interface SourceDialogProps {
  source: Source;
  onClose: () => void;
  /** Open the passage in the reader; hidden when not provided */
  onOpenInReader?: (source: Source) => void;
}

/** Shows the exact passage an answer cited. */
export const SourceDialog: React.FC<SourceDialogProps> = ({ source, onClose, onOpenInReader }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 no-print" role="dialog" aria-modal="true" aria-label={`Source ${source.n}`}>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm dialog-backdrop" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl dialog-panel overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-slate-100">
          <div className="flex items-start gap-3 min-w-0">
            <span className="flex-shrink-0 w-8 h-8 rounded-lg bg-indigo-600 text-white font-bold flex items-center justify-center">{source.n}</span>
            <div className="min-w-0">
              <p className="font-bold text-slate-900 truncate flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                {source.document_title || 'Document'}
              </p>
              {source.location && <p className="text-xs text-slate-500 mt-0.5">{source.location}</p>}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <blockquote className="px-6 py-5 max-h-80 overflow-y-auto text-sm text-slate-700 leading-relaxed whitespace-pre-wrap border-l-4 border-indigo-200 mx-6 my-5 bg-indigo-50/40 rounded-r-xl">
          {source.text}
        </blockquote>
        {onOpenInReader && (
          <div className="px-6 pb-5">
            <button
              onClick={() => onOpenInReader(source)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 transition-colors"
            >
              <BookOpen className="w-4 h-4" /> Open in Reader
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
