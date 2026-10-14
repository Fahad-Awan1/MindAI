import React, { useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { getErrorMessage } from '../../services/api';
import { Question } from '../../assessment/types';

/** Edit form for the fields every type shares, plus each type's answer. */
export const EditForm: React.FC<{ question: Question; onSave: (q: Question) => Promise<void>; onCancel: () => void }> = ({ question, onSave, onCancel }) => {
  // Matching questions are edited with each match next to its term (the server shuffles them again)
  const [draft, setDraft] = useState<Question>(() => question.type === 'matching'
    ? { ...question, right: (question.left || []).map((_, li) => question.right?.[(question.pairs || []).find(p => p[0] === li)?.[1] ?? li] ?? '') }
    : question);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Question>) => setDraft(d => ({ ...d, ...patch }));
  const lines = (text: string) => text.split('\n').map(s => s.trim()).filter(Boolean);
  const input = 'w-full rounded-xl border-slate-200 bg-white text-sm focus:border-primary-500 focus:ring-primary-500';

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not save the question.'));
      setSaving(false);
    }
  };


  return (
    <div className="mt-3 p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3 animate-slide-up">
      {draft.parent_stem !== undefined && draft.parent_stem !== null && (
        <label className="block text-xs font-bold text-slate-500">Shared scenario <span className="font-normal">(applies to every part of this question)</span>
          <textarea value={draft.parent_stem} onChange={e => set({ parent_stem: e.target.value })} rows={2} className={`${input} mt-1`} />
        </label>
      )}
      <label className="block text-xs font-bold text-slate-500">Question
        <textarea value={draft.question} onChange={e => set({ question: e.target.value })} rows={2} className={`${input} mt-1`} />
      </label>
      {(draft.type === 'mcq' || draft.type === 'multi_select') && (
        <div className="space-y-1.5">
          <p className="text-xs font-bold text-slate-500">Options <span className="font-normal">(tick the correct {draft.type === 'mcq' ? 'one' : 'ones'})</span></p>
          {(draft.options || []).map((opt, i) => {
            const checked = draft.type === 'mcq' ? draft.correct_answer_index === i : (draft.correct_indices || []).includes(i);
            return (
              <div key={i} className="flex items-center gap-2">
                <input type={draft.type === 'mcq' ? 'radio' : 'checkbox'} checked={checked} onChange={() => draft.type === 'mcq'
                  ? set({ correct_answer_index: i })
                  : set({ correct_indices: checked ? (draft.correct_indices || []).filter(x => x !== i) : [...(draft.correct_indices || []), i].sort() })} />
                <input value={opt} onChange={e => set({ options: (draft.options || []).map((o, j) => (j === i ? e.target.value : o)) })} className={input} />
              </div>
            );
          })}
        </div>
      )}
      {draft.type === 'true_false' && (
        <div className="flex gap-2">
          {[true, false].map(v => (
            <button key={String(v)} type="button" onClick={() => set({ correct_bool: v, correct_answer_index: v ? 0 : 1 })}
              className={`px-4 py-1.5 rounded-lg text-sm font-bold ${draft.correct_bool === v ? 'bg-primary-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>{v ? 'True' : 'False'}</button>
          ))}
        </div>
      )}
      {draft.type === 'fill_blank' && (
        <label className="block text-xs font-bold text-slate-500">Accepted answers, one blank per line (separate alternatives with “|”)
          <textarea rows={2} className={`${input} mt-1`} value={(draft.blanks || []).map(b => b.accepted.join(' | ')).join('\n')}
            onChange={e => set({ blanks: lines(e.target.value).map(l => ({ accepted: l.split('|').map(s => s.trim()).filter(Boolean) })) })} />
        </label>
      )}
      {draft.type === 'matching' && (
        <label className="block text-xs font-bold text-slate-500">Pairs, one per line: term =&gt; match
          <textarea rows={4} className={`${input} mt-1 font-mono text-xs`}
            defaultValue={(draft.left || []).map((l, i) => `${l} => ${draft.right?.[i] ?? ''}`).join('\n')}
            onChange={e => {
              const pairs = lines(e.target.value).map(l => l.split('=>').map(s => s.trim())).filter(p => p.length === 2 && p[0] && p[1]);
              set({ left: pairs.map(p => p[0]), right: pairs.map(p => p[1]) });
            }} />
        </label>
      )}
      {draft.type === 'ordering' && (
        <label className="block text-xs font-bold text-slate-500">Items in the correct order, one per line
          <textarea rows={4} className={`${input} mt-1`} value={(draft.items || []).join('\n')} onChange={e => set({ items: lines(e.target.value) })} />
        </label>
      )}
      {draft.type === 'numeric' && (
        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs font-bold text-slate-500">Answer<input className={`${input} mt-1`} value={String(draft.answer ?? '')} onChange={e => set({ answer: parseFloat(e.target.value) })} /></label>
          <label className="text-xs font-bold text-slate-500">± tolerance<input className={`${input} mt-1`} value={String(draft.tolerance ?? 0)} onChange={e => set({ tolerance: parseFloat(e.target.value) || 0 })} /></label>
          <label className="text-xs font-bold text-slate-500">Unit<input className={`${input} mt-1`} value={draft.unit ?? ''} onChange={e => set({ unit: e.target.value })} /></label>
        </div>
      )}
      {draft.type === 'short_answer' && (
        <label className="block text-xs font-bold text-slate-500">Model answer
          <textarea rows={2} className={`${input} mt-1`} value={draft.model_answer ?? ''} onChange={e => set({ model_answer: e.target.value })} />
        </label>
      )}
      {(draft.type === 'short' || draft.type === 'long' || (draft.type === 'mcq' && draft.section_id)) && (
        <label className="block text-xs font-bold text-slate-500">Marks
          <input type="number" min={1} max={50} value={draft.marks ?? 1} onChange={e => set({ marks: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} className={`${input} mt-1 w-24`} />
        </label>
      )}
      {(draft.type === 'short' || draft.type === 'long') && (
        <>
          <label className="block text-xs font-bold text-slate-500">Model answer
            <textarea rows={draft.type === 'long' ? 5 : 3} className={`${input} mt-1`} value={draft.answer_key ?? ''} onChange={e => set({ answer_key: e.target.value })} />
          </label>
          <label className="block text-xs font-bold text-slate-500">Mark scheme, one point per line: <span className="font-mono font-normal">point | marks</span> <span className="font-normal">(rescaled to the total marks)</span>
            <textarea rows={4} className={`${input} mt-1 font-mono text-xs`}
              defaultValue={(draft.marking_scheme || []).map(p => `${p.point} | ${p.marks}`).join('\n')}
              onChange={e => set({ marking_scheme: lines(e.target.value).map(l => {
                const [point, marks] = l.split('|').map(x => x.trim());
                return { point, marks: parseFloat(marks) || 1 };
              }).filter(p => p.point) })} />
          </label>
        </>
      )}
      {draft.type !== 'short' && draft.type !== 'long' && (
      <label className="block text-xs font-bold text-slate-500">Explanation
        <textarea value={draft.explanation ?? ''} onChange={e => set({ explanation: e.target.value })} rows={2} className={`${input} mt-1`} />
      </label>
      )}
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 rounded-lg text-sm font-semibold text-slate-500 hover:bg-white">Cancel</button>
        <button type="button" onClick={save} disabled={saving} className="px-4 py-1.5 rounded-lg bg-slate-900 text-white text-sm font-bold flex items-center gap-1.5 disabled:opacity-50">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save
        </button>
      </div>
    </div>
  );
};
