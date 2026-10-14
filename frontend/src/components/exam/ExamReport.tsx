import React, { useState } from 'react';
import { BookOpen, CheckCircle2, ChevronDown, Clock, Gauge, Loader2, MessageSquareWarning, RotateCcw, Sparkles, Target, XCircle, MinusCircle } from 'lucide-react';
import { ExamAttempt, ExamPaperV2, ExamReport as Report, QuestionMark, Question } from '../../assessment/types';
import { examsAPI, getErrorMessage } from '../../services/api';
import { CountUp } from '../../motion';
import { Confetti } from '../Confetti';
import { formatDuration } from '../quiz/bits';
import { groupLabel, sectionGroups } from './ExamPaper';

interface ExamReportProps {
  exam: ExamPaperV2;
  attempt: ExamAttempt | null;
  /** Live marking state while the stream runs */
  marking: Record<string, QuestionMark>;
  markingIds: Set<string>;
  liveReport: Report | null;
  waiting: number;
  answers: Record<string, string | number>;
  onAttemptChange: (attempt: ExamAttempt) => void;
  onRetry: () => void;
  onDiscuss: (q: Question, answer: string) => void;
}

const GRADE_COLORS: Record<string, string> = {
  'A*': 'from-emerald-400 to-teal-500', A: 'from-emerald-400 to-green-500', B: 'from-sky-400 to-blue-500',
  C: 'from-amber-400 to-orange-500', D: 'from-orange-400 to-rose-500', E: 'from-rose-400 to-red-500', U: 'from-slate-400 to-slate-600',
};

const Bar: React.FC<{ label: string; awarded: number; max: number; delay: number }> = ({ label, awarded, max, delay }) => {
  const pct = max ? Math.round((100 * awarded) / max) : 0;
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="text-sm font-semibold text-slate-700 truncate">{label}</span>
        <span className="text-xs font-bold text-slate-500 tabular-nums">{awarded}/{max} · {pct}%</span>
      </div>
      <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full origin-left ${pct >= 70 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`}
          style={{ width: `${Math.max(3, pct)}%`, animation: `barX 1.2s cubic-bezier(0.16,1,0.3,1) ${delay}ms backwards` }} />
      </div>
    </li>
  );
};

export const ExamReport: React.FC<ExamReportProps> = ({ exam, attempt, marking, markingIds, liveReport, waiting, answers, onAttemptChange, onRetry, onDiscuss }) => {
  const report = attempt?.report || liveReport;
  const grading = attempt?.grading || marking;
  const answerOf = (qid: string) => (attempt?.answers || answers)[qid];
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [remarking, setRemarking] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [remarkMsg, setRemarkMsg] = useState<Record<string, string>>({});
  const done = Object.keys(grading).length;
  const total = exam.questions.length;

  const submitRemark = async (qid: string) => {
    if (!attempt) return;
    setBusy(true);
    try {
      const r = await examsAPI.remark(attempt.id, qid, reason);
      onAttemptChange(r.attempt);
      setRemarkMsg(m => ({ ...m, [qid]: r.result.awarded_marks > r.before
        ? `Re-marked: ${r.before} → ${r.result.awarded_marks} marks.` : `Re-marked: the mark stays at ${r.result.awarded_marks}. ${r.result.feedback}` }));
      setRemarking(null);
      setReason('');
    } catch (err) {
      setRemarkMsg(m => ({ ...m, [qid]: getErrorMessage(err, 'Re-mark failed.') }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-10">
      {/* Headline */}
      {report ? (
        <div className="relative overflow-hidden rounded-[2rem] bg-[#0b0a1a] text-white p-6 md:p-8 shadow-2xl grain stack dialog-panel">
          <div className="mesh-blob w-80 h-80 -top-32 -left-20 bg-sky-600/40" />
          <div className="mesh-blob w-72 h-72 -bottom-32 right-0 bg-violet-600/40" style={{ animationDelay: '-7s' }} />
          {report.pct >= 70 && <Confetti />}
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className={`w-32 h-32 rounded-[2rem] bg-gradient-to-br ${GRADE_COLORS[report.grade] || GRADE_COLORS.U} flex flex-col items-center justify-center shadow-2xl animate-pop flex-shrink-0`}>
              <span className="text-5xl font-display font-black">{report.grade}</span>
              <span className="text-[10px] uppercase tracking-[0.2em] text-white/80">grade</span>
            </div>
            <div className="flex-1 text-center sm:text-left">
              <p className="page-eyebrow text-sky-300">Exam result{attempt?.late ? ' · submitted late' : ''}</p>
              <h2 className="text-4xl md:text-5xl font-display font-bold mt-1 tabular-nums">
                <CountUp value={report.total_awarded} decimals={report.total_awarded % 1 ? 1 : 0} /> <span className="text-white/40 text-3xl">/ {report.total_marks}</span>
              </h2>
              <div className="mt-3 flex flex-wrap justify-center sm:justify-start gap-2 text-sm">
                <span className="px-3 py-1.5 rounded-xl bg-white/10 font-semibold">{report.pct}%</span>
                {report.time_spent_ms !== null && <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10"><Clock className="w-4 h-4 text-sky-300" /> {formatDuration(report.time_spent_ms)} of {report.duration_minutes} min</span>}
                <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10" title="This score blended with your topic mastery"><Gauge className="w-4 h-4 text-emerald-300" /> Exam readiness {report.readiness}%</span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-3xl border border-slate-100 shadow-xl p-6 flex items-center gap-4 animate-rise">
          <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
          <div className="flex-1">
            <p className="font-display font-bold text-xl text-slate-900">Marking your paper…</p>
            <p className="text-sm text-slate-500">{waiting > 0 ? `Pacing requests for the free AI tier · ${waiting}s` : 'Checking each answer against the mark scheme and your notes.'}</p>
            <div className="mt-3 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-gradient-to-r from-sky-500 to-blue-600 transition-all duration-700" style={{ width: `${(done / Math.max(1, total)) * 100}%` }} /></div>
          </div>
          <span className="text-2xl font-display font-bold tabular-nums">{done}<span className="text-slate-300">/{total}</span></span>
        </div>
      )}

      {report && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6">
            <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-4"><Target className="w-4 h-4 text-slate-400" /> By section</h3>
            <ul className="space-y-3">{report.sections.map((s, i) => <Bar key={s.id} label={`Section ${s.id} · ${s.title}`} awarded={s.awarded} max={s.max} delay={i * 80} />)}</ul>
            {report.by_topic.length > 0 && (
              <>
                <h3 className="font-bold text-slate-800 mt-6 mb-3">By topic</h3>
                <ul className="space-y-3">{report.by_topic.slice(0, 6).map((t, i) => <Bar key={t.label} label={t.label} awarded={t.awarded} max={t.max} delay={i * 80} />)}</ul>
              </>
            )}
          </div>
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6">
            <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-4"><Sparkles className="w-4 h-4 text-violet-500" /> What to do next</h3>
            <ol className="space-y-3">
              {(report.next_steps || []).map((step, i) => (
                <li key={i} className="flex gap-3 text-sm text-slate-700" style={{ animation: `rise 0.8s cubic-bezier(0.16,1,0.3,1) ${i * 120}ms backwards` }}>
                  <span className="w-6 h-6 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center flex-shrink-0">{i + 1}</span>{step}
                </li>
              ))}
            </ol>
            {report.by_bloom.length > 0 && (
              <>
                <h3 className="font-bold text-slate-800 mt-6 mb-3">By thinking level</h3>
                <ul className="space-y-3">{report.by_bloom.map((t, i) => <Bar key={t.label} label={t.label.charAt(0).toUpperCase() + t.label.slice(1)} awarded={t.awarded} max={t.max} delay={i * 80} />)}</ul>
              </>
            )}
            <button onClick={onRetry} className="mt-6 w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-slate-900 text-white font-bold btn-fill"><RotateCcw className="w-4 h-4" /> Sit the exam again</button>
          </div>
        </div>
      )}

      {/* Per question */}
      <div className="space-y-4">
        {exam.sections.map(section => (
          <div key={section.id} className="space-y-3">
            <h3 className="font-bold text-slate-800">Section {section.id} · {section.title}</h3>
            {sectionGroups(exam, section.id).flat().map(q => {
              const mark = grading[q.id];
              const isMarking = markingIds.has(q.id) && !mark;
              const answer = answerOf(q.id);
              const pct = mark ? mark.awarded_marks / Math.max(1, mark.max_marks) : 0;
              const isOpen = open[q.id] ?? (!!mark && pct < 1 && q.type !== 'mcq');
              return (
                <div key={q.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all duration-500 ${!mark ? 'border-slate-100' : pct >= 0.999 ? 'border-emerald-100' : pct > 0 ? 'border-amber-100' : 'border-rose-100'}`}>
                  <button onClick={() => setOpen(o => ({ ...o, [q.id]: !isOpen }))} className="w-full flex items-center gap-3 p-4 text-left">
                    {isMarking ? <Loader2 className="w-5 h-5 text-sky-500 animate-spin" /> : !mark ? <span className="w-5 h-5 rounded-full border-2 border-slate-200" /> : pct >= 0.999 ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : pct > 0 ? <MinusCircle className="w-5 h-5 text-amber-500" /> : <XCircle className="w-5 h-5 text-rose-500" />}
                    <span className="text-xs font-bold text-slate-400 w-10">Q{q.label}</span>
                    <span className="flex-1 min-w-0 text-sm font-semibold text-slate-800 truncate">{q.question}</span>
                    <span className={`text-sm font-bold tabular-nums ${mark ? 'text-slate-800 animate-pop' : 'text-slate-300'}`}>{mark ? `${mark.awarded_marks}/${mark.max_marks}` : `–/${q.marks}`}</span>
                    <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isOpen && mark && (
                    <div className="px-5 pb-5 space-y-3 text-sm animate-fade-in">
                      {q.parent_stem && <p className="text-slate-500 italic">{q.parent_stem}</p>}
                      <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">Your answer</p>
                        <p className="text-slate-700 whitespace-pre-wrap">{q.type === 'mcq'
                          ? (typeof answer === 'number' && answer >= 0 ? `${String.fromCharCode(65 + answer)}) ${q.options?.[answer]}` : '(not answered)')
                          : (answer ? String(answer) : '(not answered)')}</p>
                      </div>
                      {mark.feedback && <p className="text-slate-700">{mark.feedback}</p>}
                      {mark.points.length > 0 && (
                        <ul className="space-y-1.5">
                          {mark.points.map((p, i) => (
                            <li key={i} className="flex items-start gap-2">
                              {p.awarded > 0 ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" /> : <XCircle className="w-4 h-4 text-rose-400 mt-0.5 flex-shrink-0" />}
                              <span className="flex-1"><span className="text-slate-700">{p.point}</span>{p.evidence && <span className="block text-xs text-slate-400 italic">{p.evidence}</span>}</span>
                              <span className="font-bold text-slate-600">{p.awarded}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {mark.missing_points.length > 0 && (
                        <div><p className="text-[11px] font-bold uppercase tracking-wider text-rose-500 mb-1">Missed</p>
                          <ul className="list-disc pl-5 text-slate-600 space-y-0.5">{mark.missing_points.map((m, i) => <li key={i}>{m}</li>)}</ul></div>
                      )}
                      {q.answer_key && (
                        <details className="group">
                          <summary className="cursor-pointer text-xs font-bold text-sky-700">Model answer</summary>
                          <p className="mt-2 p-3 rounded-xl bg-sky-50 border border-sky-100 text-slate-700 whitespace-pre-wrap">{q.answer_key}</p>
                        </details>
                      )}
                      {remarkMsg[q.id] && <p className="text-xs font-semibold text-violet-700 bg-violet-50 rounded-lg p-2">{remarkMsg[q.id]}</p>}
                      {attempt && q.type !== 'mcq' && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          <button onClick={() => onDiscuss(q, String(answer ?? ''))} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700"><BookOpen className="w-3.5 h-3.5" /> Discuss with tutor</button>
                          {pct < 1 && <button onClick={() => setRemarking(remarking === q.id ? null : q.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 hover:border-violet-300"><MessageSquareWarning className="w-3.5 h-3.5" /> I deserve more marks</button>}
                        </div>
                      )}
                      {remarking === q.id && (
                        <div className="p-3 rounded-xl border border-violet-200 bg-violet-50/50 space-y-2 animate-slide-up">
                          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} maxLength={1500} placeholder="Explain which point you made that wasn't credited…"
                            className="w-full rounded-lg border-violet-200 text-sm focus:border-violet-500 focus:ring-violet-500" />
                          <div className="flex justify-end gap-2">
                            <button onClick={() => setRemarking(null)} className="px-3 py-1.5 text-xs font-semibold text-slate-500">Cancel</button>
                            <button onClick={() => submitRemark(q.id)} disabled={busy || reason.trim().length < 5} className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-bold disabled:opacity-50 flex items-center gap-1.5">
                              {busy && <Loader2 className="w-3 h-3 animate-spin" />} Request re-mark
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};

export { groupLabel };
