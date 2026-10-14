import React, { useEffect, useState } from 'react';
import { Award, Clock, Eye, EyeOff, History, Lock, Play, ChevronRight, Pencil, Save, Loader2, Check, Landmark, BookmarkPlus } from 'lucide-react';
import { ExamAttempt, ExamPaperV2, PaperHeader as Header, Question } from '../../assessment/types';
import { assessmentAPI, examsAPI, getErrorMessage } from '../../services/api';
import { StudySet } from '../../types';
import { ExportMenu } from '../quiz/ExportMenu';
import { EditForm } from '../quiz/EditForm';
import { QuestionActions } from '../quiz/QuestionActions';
import { PaperHeader, defaultHeader, saveDefaultHeader } from './PaperHeader';

/** Questions of a section in order, with sub-parts grouped under their shared scenario. */
export const sectionGroups = (exam: ExamPaperV2, sectionId: string): Question[][] => {
  const byId = new Map(exam.questions.map(q => [q.id, q]));
  const section = exam.sections.find(s => s.id === sectionId);
  const leaves = (section?.question_ids || []).map(id => byId.get(id)).filter((q): q is Question => !!q);
  const groups: Question[][] = [];
  const index = new Map<string, number>();
  for (const q of leaves) {
    if (q.parent_id && index.has(q.parent_id)) groups[index.get(q.parent_id)!].push(q);
    else {
      if (q.parent_id) index.set(q.parent_id, groups.length);
      groups.push([q]);
    }
  }
  return groups;
};

export const groupLabel = (group: Question[]) => (group[0].label || '').replace(/\(.*\)$/, '');

interface ExamPaperProps {
  setId: string;
  exam: ExamPaperV2;
  onStart: () => void;
  onOpenAttempt: (attempt: ExamAttempt) => void;
  starting: boolean;
  /** The saved paper changed (edited details or questions) */
  onSetChange: (set: StudySet<unknown>) => void;
}

interface Draft {
  title: string;
  duration: number;
  instructions: string[];
  header: Header | null;
  sections: Record<string, { title: string; instructions: string; attempt_any: number | null }>;
}

const fmtDate = (ms: number) => new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

const draftFrom = (exam: ExamPaperV2): Draft => ({
  title: exam.title,
  duration: exam.duration_minutes,
  instructions: exam.instructions?.length ? exam.instructions : ['Answer all questions.', 'The marks for each question are shown in brackets.'],
  header: exam.header || null,
  sections: Object.fromEntries(exam.sections.map(s => [s.id, { title: s.title, instructions: s.instructions, attempt_any: s.attempt_any }])),
});

export const ExamPaper: React.FC<ExamPaperProps> = ({ setId, exam, onStart, onOpenAttempt, starting, onSetChange }) => {
  const [showKey, setShowKey] = useState(false);
  const [history, setHistory] = useState<ExamAttempt[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(exam));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingQ, setEditingQ] = useState<string | null>(null);
  const [busyQ, setBusyQ] = useState<Record<string, string>>({});
  const keyHidden = (exam as ExamPaperV2 & { key_hidden?: boolean }).key_hidden;

  useEffect(() => {
    examsAPI.list(setId).then(setHistory).catch(() => setHistory([]));
  }, [setId]);

  // Fresh draft whenever editing starts (or the paper changes while not editing)
  useEffect(() => {
    if (!dirty) setDraft(draftFrom(exam));
  }, [exam, dirty]);

  const inProgress = history?.find(a => a.status !== 'graded');
  const update = (patch: Partial<Draft>) => { setDraft(d => ({ ...d, ...patch })); setDirty(true); };
  const updateSection = (id: string, patch: Partial<Draft['sections'][string]>) =>
    update({ sections: { ...draft.sections, [id]: { ...draft.sections[id], ...patch } } });

  const saveDetails = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await assessmentAPI.updateMeta(setId, {
        title: draft.title.trim() || exam.title,
        duration_minutes: draft.duration,
        instructions: draft.instructions.map(s => s.trim()).filter(Boolean),
        header: draft.header,
        sections: Object.entries(draft.sections).map(([id, s]) => ({ id, ...s })),
      });
      setDirty(false);
      onSetChange(updated);
      setNotice('Paper saved.');
      window.setTimeout(() => setNotice(null), 2500);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not save the paper.'));
    } finally {
      setSaving(false);
    }
  };

  const runQ = async (qid: string, label: string, action: () => Promise<StudySet<unknown>>) => {
    setBusyQ(b => ({ ...b, [qid]: label }));
    setError(null);
    try {
      onSetChange(await action());
    } catch (err) {
      setError(getErrorMessage(err, 'That change failed. Please try again.'));
    } finally {
      setBusyQ(b => { const n = { ...b }; delete n[qid]; return n; });
    }
  };

  const view = editing ? draft : draftFrom(exam);
  const header = view.header;

  return (
    <div className="flex flex-col items-center">
      {/* Toolbar */}
      <div className="no-print w-full max-w-4xl mb-6 bg-white rounded-3xl shadow-xl border border-slate-100 p-5 md:p-6 animate-rise">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="page-eyebrow text-sky-600">Exam paper</p>
            <h2 className="text-2xl font-display font-bold text-slate-900 truncate">{exam.title}</h2>
            <p className="text-sm text-slate-500 mt-1 flex flex-wrap gap-x-4">
              <span className="flex items-center gap-1"><Award className="w-4 h-4 text-amber-500" /> {exam.total_marks} marks</span>
              <span className="flex items-center gap-1"><Clock className="w-4 h-4 text-sky-500" /> {exam.duration_minutes} minutes</span>
              <span>{exam.sections.length} section{exam.sections.length === 1 ? '' : 's'}</span>
            </p>
          </div>
          {!editing ? (
            <>
              <button onClick={() => { setDraft(draftFrom(exam)); setDirty(false); setEditing(true); setShowKey(false); }} disabled={!!keyHidden}
                title={keyHidden ? 'Finish the exam you are sitting before editing' : 'Edit the header and the questions'}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                <Pencil className="w-4 h-4" /> Edit paper
              </button>
              <button onClick={() => setShowKey(v => !v)} disabled={keyHidden} title={keyHidden ? 'Locked while an attempt is in progress' : ''}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                {keyHidden ? <Lock className="w-4 h-4" /> : showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />} {showKey ? 'Hide' : 'Show'} mark scheme
              </button>
              <ExportMenu setId={setId} title={exam.title} questions={exam.questions} kind="exam" keyLocked={!!keyHidden} />
              <button onClick={onStart} disabled={starting} data-cursor="Begin"
                className="btn-shine flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white font-bold shadow-lg shadow-sky-500/30 disabled:opacity-60">
                <Play className="w-4 h-4 fill-current" /> {inProgress ? 'Resume exam' : 'Sit this exam'}
              </button>
            </>
          ) : (
            <>
              <button onClick={saveDetails} disabled={saving || !dirty} className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-sky-600 text-white text-sm font-bold disabled:opacity-40">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save changes
              </button>
              <button onClick={() => { if (!dirty || window.confirm('Discard unsaved changes to the header?')) { setEditing(false); setDirty(false); setEditingQ(null); } }}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold">
                <Check className="w-4 h-4" /> Done
              </button>
            </>
          )}
        </div>

        {editing && (
          <div className="mt-5 pt-4 border-t border-slate-100 space-y-3 animate-fade-in">
            <p className="text-sm text-sky-900 bg-sky-50 rounded-xl p-3">
              <span className="font-bold">Editing.</span> Click any text on the paper below to change it. Header and section changes are saved with <span className="font-semibold">Save changes</span>; each question saves on its own.
            </p>
            <div className="flex flex-wrap items-end gap-4">
              <label className="text-xs font-bold text-slate-500 flex-1 min-w-[14rem]">Paper name (in your library)
                <input value={draft.title} onChange={e => update({ title: e.target.value })} maxLength={200} className="mt-1 w-full rounded-xl border-slate-200 text-sm focus:border-sky-500 focus:ring-sky-500" />
              </label>
              <label className="text-xs font-bold text-slate-500">Time allowed (minutes)
                <input type="number" min={5} max={360} value={draft.duration} onChange={e => update({ duration: Math.max(5, Math.min(360, Number(e.target.value) || 5)) })} className="mt-1 w-28 block rounded-xl border-slate-200 text-sm focus:border-sky-500 focus:ring-sky-500" />
              </label>
              {draft.header ? (
                <div className="flex gap-2">
                  <button type="button" onClick={() => { saveDefaultHeader(draft.header!); setNotice('Saved as your default header for new papers.'); window.setTimeout(() => setNotice(null), 3000); }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"><BookmarkPlus className="w-4 h-4" /> Use as my default</button>
                  <button type="button" onClick={() => update({ header: null })} className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-500 hover:bg-slate-50">Simple header</button>
                </div>
              ) : (
                <button type="button" onClick={() => update({ header: defaultHeader() })}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-50 border border-sky-200 text-xs font-bold text-sky-700 hover:bg-sky-100"><Landmark className="w-4 h-4" /> Use a university header (logo, details table)</button>
              )}
            </div>
          </div>
        )}
        {(notice || error) && <p className={`mt-3 text-sm rounded-xl p-2.5 ${error ? 'text-rose-700 bg-rose-50' : 'text-emerald-800 bg-emerald-50'}`}>{error || notice}</p>}

        {!editing && history && history.length > 0 && (
          <div className="mt-5 pt-4 border-t border-slate-100">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 flex items-center gap-1.5 mb-2"><History className="w-3.5 h-3.5" /> Your attempts</p>
            <div className="flex flex-wrap gap-2">
              {history.map(a => (
                <button key={a.id} onClick={() => a.status === 'graded' ? onOpenAttempt(a) : onStart()}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-100 hover:border-sky-300 text-sm transition-colors">
                  {a.status === 'graded' && a.report ? (
                    <><span className="w-7 h-7 rounded-lg bg-slate-900 text-white text-xs font-bold flex items-center justify-center">{a.report.grade}</span>
                      <span className="font-semibold text-slate-700">{a.report.pct}%</span></>
                  ) : <span className="font-semibold text-amber-600">In progress</span>}
                  <span className="text-xs text-slate-400">{fmtDate(a.started_at)}</span>
                  <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* The paper */}
      <div className={`print-content bg-white w-full max-w-[210mm] md:min-h-[297mm] p-4 sm:p-[12mm] md:p-[18mm] shadow-2xl text-slate-900 mx-auto font-serif relative animate-rise ${editing ? 'ring-2 ring-sky-300 ring-offset-4' : ''}`} style={{ animationDelay: '150ms', animationFillMode: 'backwards' }}>
        {header ? (
          <PaperHeader header={header} editing={editing} duration={view.duration} totalMarks={exam.total_marks} instructions={view.instructions}
            onChange={h => update({ header: h })} onInstructionsChange={lines => update({ instructions: lines })} onError={setError} />
        ) : (
          <>
            <div className="border-b-2 border-black pb-6 mb-8 text-center">
              {editing ? (
                <input value={draft.title} onChange={e => update({ title: e.target.value })} className="w-full text-center text-2xl md:text-3xl font-bold uppercase tracking-wide bg-transparent border-0 border-b border-dashed border-sky-300 focus:ring-0 focus:border-sky-600" />
              ) : <h1 className="text-2xl md:text-3xl font-bold mb-2 uppercase tracking-wide">{exam.title}</h1>}
              <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 text-base md:text-lg italic mt-4 font-semibold">
                <span>Time allowed: {view.duration} minutes</span>
                <span>Maximum marks: {exam.total_marks}</span>
              </div>
              <div className="flex flex-wrap justify-between gap-x-6 gap-y-2 text-sm md:text-base mt-4 pt-4 border-t border-slate-200">
                <span>Name: ______________________</span>
                <span>Date: ______________________</span>
              </div>
            </div>
            <div className="mb-8">
              <h3 className="font-bold uppercase text-sm mb-2">Instructions</h3>
              {editing ? (
                <textarea value={draft.instructions.join('\n')} onChange={e => update({ instructions: e.target.value.split('\n') })} rows={3}
                  className="w-full text-sm border border-dashed border-sky-300 rounded p-2 focus:ring-0 focus:border-sky-600" placeholder="One instruction per line" />
              ) : (
                <ul className="list-disc pl-5 text-sm space-y-1">
                  {view.instructions.filter(Boolean).map((t, i) => <li key={i}>{t}</li>)}
                  {exam.sections.length > 1 && <li>This paper has {exam.sections.length} sections: {exam.sections.map(s => `${s.id} (${s.marks} marks)`).join(', ')}.</li>}
                </ul>
              )}
            </div>
          </>
        )}

        {exam.sections.map(section => {
          const sd = view.sections[section.id] || { title: section.title, instructions: section.instructions, attempt_any: section.attempt_any };
          const groups = sectionGroups(exam, section.id);
          return (
            <section key={section.id} className="mb-10">
              <div className="flex items-baseline justify-between gap-3 border-b border-slate-300 pb-2 mb-4">
                {editing ? (
                  <span className="flex items-baseline gap-2 flex-1 min-w-0">
                    <span className="text-lg font-bold uppercase">Section {section.id} ·</span>
                    <input value={sd.title} onChange={e => updateSection(section.id, { title: e.target.value })} className="flex-1 min-w-0 text-lg font-bold uppercase bg-transparent border-0 border-b border-dashed border-sky-300 p-0 focus:ring-0 focus:border-sky-600" />
                  </span>
                ) : <h2 className="text-lg font-bold uppercase tracking-wide">Section {section.id} · {sd.title}</h2>}
                <span className="text-sm font-semibold italic whitespace-nowrap">[{section.marks} marks]</span>
              </div>
              {editing ? (
                <div className="mb-5 flex flex-wrap items-center gap-3 font-sans">
                  <input value={sd.instructions} onChange={e => updateSection(section.id, { instructions: e.target.value })} placeholder="Section instructions"
                    className="flex-1 min-w-[14rem] text-sm italic rounded-lg border-dashed border-sky-300 focus:ring-0 focus:border-sky-600" />
                  {section.kind !== 'objective' && groups.length > 1 && (
                    <label className="text-xs font-bold text-slate-500 flex items-center gap-1.5">Answer any
                      <input type="number" min={0} max={groups.length - 1} value={sd.attempt_any ?? 0}
                        onChange={e => updateSection(section.id, { attempt_any: Number(e.target.value) || null })} className="w-14 rounded-lg border-slate-200 text-sm py-1" />
                      of {groups.length} <span className="font-normal">(0 = all)</span>
                    </label>
                  )}
                </div>
              ) : <p className="text-sm italic mb-5">{sd.instructions}</p>}

              <div className="space-y-7">
                {groups.map(group => (
                  <div key={group[0].id} className="break-inside-avoid">
                    {group[0].parent_stem && (
                      <p className="text-[17px] leading-relaxed mb-3"><span className="font-bold mr-2">{header ? `Q # ${groupLabel(group)}.` : `${groupLabel(group)}.`}</span>{group[0].parent_stem}</p>
                    )}
                    {group.map(q => (
                      <div key={q.id} className={`${q.parent_stem ? 'pl-3 sm:pl-6 mb-3' : ''} ${editing ? 'rounded-xl -mx-3 px-3 py-2 hover:bg-sky-50/50 transition-colors' : ''}`}>
                        <div className="flex flex-col sm:flex-row sm:justify-between items-start gap-1 sm:gap-4">
                          <div className="flex gap-2 flex-1 min-w-0 w-full">
                            <span className="font-bold whitespace-nowrap">{q.parent_stem ? `(${(q.label || '').match(/\((.)\)/)?.[1] || ''})` : header ? `Q # ${q.label}.` : `${q.label}.`}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-[17px] leading-relaxed whitespace-pre-wrap break-anywhere">{q.question}</p>
                              {q.type === 'mcq' && (
                                <ol className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-[15px]">
                                  {(q.options || []).map((o, i) => <li key={i}><span className="font-bold mr-1.5">{String.fromCharCode(65 + i)})</span>{o}</li>)}
                                </ol>
                              )}
                              {q.type !== 'mcq' && !showKey && (
                                <div className="hidden print:block mt-3 space-y-5" aria-hidden="true">
                                  {Array.from({ length: q.type === 'long' ? 8 : 3 }).map((_, i) => <div key={i} className="border-b border-slate-300 h-1" />)}
                                </div>
                              )}
                              {showKey && !editing && (
                                <div className="mt-3 p-4 bg-slate-50 border-l-4 border-sky-500 text-sm font-sans text-slate-700 break-inside-avoid animate-fade-in">
                                  {q.type === 'mcq'
                                    ? <p><span className="font-bold">Answer:</span> {String.fromCharCode(65 + (q.correct_answer_index ?? 0))}) {q.options?.[q.correct_answer_index ?? 0]}</p>
                                    : <>
                                        <p className="font-bold text-xs uppercase tracking-wide text-slate-500 mb-1">Model answer</p>
                                        <p className="whitespace-pre-wrap">{q.answer_key}</p>
                                        {!!q.marking_scheme?.length && (
                                          <>
                                            <p className="font-bold text-xs uppercase tracking-wide text-slate-500 mt-3 mb-1">Mark scheme</p>
                                            <ul className="space-y-0.5">
                                              {q.marking_scheme.map((p, i) => <li key={i} className="flex justify-between gap-3"><span>• {p.point}</span><span className="font-bold whitespace-nowrap">{p.marks}</span></li>)}
                                            </ul>
                                          </>
                                        )}
                                      </>}
                                </div>
                              )}
                            </div>
                          </div>
                          <span className="font-bold whitespace-nowrap self-end sm:self-auto">{header ? `(${q.marks} Marks)` : `[${q.marks}]`}</span>
                        </div>
                        {editing && (
                          <div className="mt-2 pl-7">
                            <QuestionActions busy={busyQ[q.id]} editing={editingQ === q.id}
                              onEdit={() => setEditingQ(editingQ === q.id ? null : q.id)}
                              onRegenerate={how => runQ(q.id, how, async () => (await assessmentAPI.regenerate(setId, q.id, how)).set)}
                              onDelete={() => runQ(q.id, 'delete', () => assessmentAPI.deleteQuestion(setId, q.id))} />
                            {editingQ === q.id && (
                              <div className="font-sans">
                                <EditForm question={q} onCancel={() => setEditingQ(null)} onSave={async d => {
                                  const r = await assessmentAPI.editQuestion(setId, q.id, d);
                                  onSetChange(r.set);
                                  setEditingQ(null);
                                }} />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
        <div className="mt-16 text-center border-t border-slate-300 pt-8 text-sm text-slate-500 italic">*** End of paper ***</div>
      </div>
    </div>
  );
};
