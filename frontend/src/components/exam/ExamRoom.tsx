import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBackHandler } from '../../hooks/useBackHandler';
import { AlertTriangle, CheckCircle2, Cloud, CloudOff, Maximize2, Minimize2, Send, Timer } from 'lucide-react';
import { ExamAttempt, ExamPaperV2 } from '../../assessment/types';
import { examsAPI } from '../../services/api';
import { QuestionView } from '../quiz/QuestionView';
import { formatDuration } from '../quiz/bits';
import { groupLabel, sectionGroups } from './ExamPaper';

type Answers = Record<string, string | number>;

interface ExamRoomProps {
  exam: ExamPaperV2;
  attempt: ExamAttempt;
  onSubmit: (answers: Answers) => void;
}

const localKey = (attemptId: string) => `mindai.exam.${attemptId}`;
const AUTOSAVE_MS = 10_000;

const readLocal = (attemptId: string): Answers | null => {
  try {
    const raw = window.localStorage.getItem(localKey(attemptId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const words = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

export const ExamRoom: React.FC<ExamRoomProps> = ({ exam, attempt, onSubmit }) => {
  const [answers, setAnswers] = useState<Answers>(() => ({ ...(attempt.answers || {}), ...(readLocal(attempt.id) || {}) }));
  const [section, setSection] = useState(exam.sections[0]?.id);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'offline'>('saved');
  const [confirming, setConfirming] = useState(false);
  // Android back: close the submit dialog, or confirm before leaving (returning false lets the app go back)
  useBackHandler(() => {
    if (confirming) { setConfirming(false); return true; }
    return window.confirm('Leave the exam? Your answers are saved, but the timer keeps running.') ? false : true;
  });
  const [fullscreen, setFullscreen] = useState(false);
  const dirty = useRef(false);
  const submitted = useRef(false);
  // Server clock offset, so the countdown can't be extended by changing the computer's clock
  const offset = useRef(attempt.server_now - Date.now());
  const [now, setNow] = useState(Date.now() + offset.current);

  const remaining = attempt.deadline_at ? attempt.deadline_at - now : null;

  const save = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    setSaveState('saving');
    try {
      await examsAPI.saveDraft(attempt.id, answers);
      setSaveState('saved');
    } catch {
      dirty.current = true;
      setSaveState('offline');
    }
  }, [answers, attempt.id]);

  const submit = useCallback(() => {
    if (submitted.current) return;
    submitted.current = true;
    try { window.localStorage.removeItem(localKey(attempt.id)); } catch { /* ignore */ }
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    onSubmit(answers);
  }, [answers, attempt.id, onSubmit]);

  // Clock + auto-submit at zero
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() + offset.current), 500);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (remaining !== null && remaining <= 0) submit();
  }, [remaining, submit]);

  // Autosave to the server every few seconds, and locally on every change
  useEffect(() => {
    const id = window.setInterval(save, AUTOSAVE_MS);
    return () => window.clearInterval(id);
  }, [save]);
  useEffect(() => {
    try { window.localStorage.setItem(localKey(attempt.id), JSON.stringify(answers)); } catch { /* ignore */ }
  }, [answers, attempt.id]);

  // Don't lose the exam by closing the tab
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (submitted.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };

  const setAnswer = (qid: string, value: string | number) => {
    dirty.current = true;
    setSaveState(s => (s === 'offline' ? 'offline' : 'saving'));
    setAnswers(prev => ({ ...prev, [qid]: value }));
  };

  const isAnswered = (qid: string) => {
    const v = answers[qid];
    return typeof v === 'number' ? v >= 0 : !!(v && String(v).trim());
  };

  const stats = useMemo(() => {
    const total = exam.questions.length;
    const answered = exam.questions.filter(q => isAnswered(q.id)).length;
    return { total, answered };
  }, [answers, exam.questions]);

  const lowTime = remaining !== null && remaining < 5 * 60_000;
  const current = exam.sections.find(s => s.id === section) || exam.sections[0];
  const groups = current ? sectionGroups(exam, current.id) : [];
  const answeredGroups = groups.filter(g => g.some(q => isAnswered(q.id))).length;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Exam bar */}
      <div className="sticky top-3 z-20 mb-5 flex flex-wrap items-center gap-3 px-4 py-3 rounded-2xl bg-slate-900 text-white shadow-2xl animate-slide-up">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold truncate">{exam.title}</p>
          <p className="text-xs text-white/60">{stats.answered}/{stats.total} answered</p>
        </div>
        <span className={`flex items-center gap-1.5 text-xs font-semibold ${saveState === 'offline' ? 'text-amber-300' : 'text-white/60'}`}>
          {saveState === 'offline' ? <CloudOff className="w-4 h-4" /> : <Cloud className="w-4 h-4" />}
          {saveState === 'saving' ? 'Saving…' : saveState === 'offline' ? 'Saved on this device' : 'Saved'}
        </span>
        <button onClick={toggleFullscreen} className="p-2 rounded-lg text-white/70 hover:bg-white/10" title={fullscreen ? 'Exit full screen' : 'Full screen'}>
          {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
        {remaining !== null && (
          <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono text-lg font-bold tabular-nums ${lowTime ? 'bg-rose-500 animate-pulse' : 'bg-white/10'}`}>
            <Timer className="w-4 h-4" /> {formatDuration(Math.max(0, remaining))}
          </span>
        )}
        <button onClick={() => setConfirming(true)} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white text-slate-900 font-bold text-sm hover:bg-sky-50">
          <Send className="w-4 h-4" /> Submit
        </button>
      </div>

      {/* Sections */}
      {exam.sections.length > 1 && (
        <div className="flex gap-2 mb-5 overflow-x-auto no-scrollbar">
          {exam.sections.map(s => {
            const done = s.question_ids.filter(isAnswered).length;
            return (
              <button key={s.id} onClick={() => setSection(s.id)}
                className={`flex-shrink-0 px-4 py-2.5 rounded-2xl border-2 text-left transition-all duration-300 ${s.id === current?.id ? 'border-sky-500 bg-sky-50 shadow-md' : 'border-slate-100 bg-white hover:border-slate-200'}`}>
                <span className="block text-sm font-bold text-slate-800">Section {s.id}</span>
                <span className="block text-[11px] text-slate-500">{done}/{s.question_ids.length} answered · {s.marks} marks</span>
              </button>
            );
          })}
        </div>
      )}

      {current && (
        <div key={current.id} className="space-y-5 animate-fade-in">
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-sky-50 border border-sky-100 text-sm text-sky-900">
            <span className="font-bold">Section {current.id} · {current.title}.</span>
            <span className="flex-1">{current.instructions}</span>
            {current.attempt_any && (
              <span className={`font-bold whitespace-nowrap ${answeredGroups > current.attempt_any ? 'text-amber-700' : ''}`}>{answeredGroups}/{current.attempt_any} chosen</span>
            )}
          </div>
          {current.attempt_any && answeredGroups > current.attempt_any && (
            <p className="flex items-center gap-2 text-sm text-amber-800 bg-amber-50 rounded-xl p-3"><AlertTriangle className="w-4 h-4" /> You've answered more than {current.attempt_any} - only your best {current.attempt_any} will count.</p>
          )}
          {groups.map(group => (
            <div key={group[0].id} className="bg-white rounded-3xl border border-slate-100 shadow-sm p-5 md:p-6">
              {group[0].parent_stem && <p className="font-semibold text-slate-800 mb-4"><span className="text-sky-600 mr-2">Q{groupLabel(group)}.</span>{group[0].parent_stem}</p>}
              <div className="space-y-6">
                {group.map(q => {
                  const value = answers[q.id];
                  return (
                    <div key={q.id}>
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <p className="font-semibold text-slate-800 leading-relaxed">
                          <span className="text-sky-600 mr-2">{q.parent_stem ? `(${(q.label || '').match(/\((.)\)/)?.[1] || ''})` : `Q${q.label}.`}</span>{q.question}
                        </p>
                        <span className="flex items-center gap-2 flex-shrink-0">
                          {isAnswered(q.id) && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                          <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-xs font-bold text-slate-600">[{q.marks}]</span>
                        </span>
                      </div>
                      {q.type === 'mcq' ? (
                        <QuestionView question={q} value={typeof value === 'number' ? value : -1} onChange={v => setAnswer(q.id, v as number)} />
                      ) : (
                        <div>
                          <textarea
                            value={typeof value === 'string' ? value : ''}
                            onChange={e => setAnswer(q.id, e.target.value)}
                            rows={q.type === 'long' ? 10 : 4}
                            maxLength={8000}
                            placeholder={q.type === 'long' ? 'Write a full, structured answer…' : 'Write your answer…'}
                            className="w-full rounded-2xl border-2 border-slate-200 bg-white px-4 py-3 text-[15px] leading-relaxed focus:outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-100 transition-colors"
                            data-lenis-prevent
                          />
                          <p className="text-[11px] text-slate-400 text-right mt-1">{words(typeof value === 'string' ? value : '')} words · ~{q.type === 'long' ? Math.round((q.marks || 10) * 25) : Math.round((q.marks || 4) * 15)} suggested</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Submit confirmation */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Submit exam">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm dialog-backdrop" onClick={() => setConfirming(false)} />
          <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl p-7 dialog-panel">
            <h3 className="text-xl font-display font-bold text-slate-900">Submit for marking?</h3>
            <p className="text-slate-600 mt-2">You've answered <span className="font-bold">{stats.answered} of {stats.total}</span> questions{remaining !== null ? ` with ${formatDuration(Math.max(0, remaining))} left` : ''}. You can't change answers after submitting.</p>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setConfirming(false)} className="px-4 py-2.5 rounded-xl font-semibold text-slate-600 hover:bg-slate-100">Keep working</button>
              <button onClick={submit} className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 text-white font-bold shadow-lg">Submit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
