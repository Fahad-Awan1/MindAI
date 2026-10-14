import React, { useEffect, useRef, useState } from 'react';
import { useBackHandler } from '../../hooks/useBackHandler';
import { createPortal } from 'react-dom';
import { ChevronDown, Download, FileText, Loader2, Printer, Table, Layers, GraduationCap, Gamepad2, ClipboardList, Copy, CircleDot } from 'lucide-react';
import { downloadExport, ExportFormat, getErrorMessage } from '../../services/api';
import { Question } from '../../assessment/types';
import { isNative } from '../../services/platform';

interface ExportMenuProps {
  setId: string;
  title: string;
  /** Questions for the printable bubble answer sheet (choice questions only) */
  questions: Question[];
  /** Exams: hide the "with key" option while an attempt is running */
  keyLocked?: boolean;
  kind: 'quiz' | 'exam';
}

const ITEMS: { format: ExportFormat; label: string; hint: string; icon: React.ElementType; version?: 'B'; key?: boolean }[] = [
  { format: 'docx', label: 'Word document', hint: 'Paper + answer key on a new page', icon: FileText, key: true },
  { format: 'docx', label: 'Word · paper only', hint: 'No answers - ready to hand out', icon: FileText, key: false },
  { format: 'docx', label: 'Word · version B', hint: 'Shuffled questions & options', icon: Copy, version: 'B', key: true },
  { format: 'moodle', label: 'Moodle XML', hint: 'Import into a Moodle question bank', icon: GraduationCap },
  { format: 'gift', label: 'Moodle GIFT', hint: 'Plain-text quiz format', icon: GraduationCap },
  { format: 'kahoot', label: 'Kahoot', hint: 'Spreadsheet for Kahoot! (choice questions)', icon: Gamepad2 },
  { format: 'anki', label: 'Anki deck', hint: 'Flashcards to import into Anki', icon: Layers },
  { format: 'gforms', label: 'Google Forms', hint: 'Script that builds a self-marking Form', icon: ClipboardList },
  { format: 'csv', label: 'CSV spreadsheet', hint: 'Every question, answer and tag', icon: Table },
];

/** A printable answer sheet with bubbles for each choice question (opens the print dialog). */
const printBubbleSheet = (title: string, questions: Question[]) => {
  const choice = questions.filter(q => ['mcq', 'true_false', 'multi_select'].includes(q.type));
  const rows = choice.map((q, i) => {
    const n = (q.options || ['True', 'False']).length;
    const bubbles = Array.from({ length: n }, (_, j) => `<span class="b">${String.fromCharCode(65 + j)}</span>`).join('');
    return `<div class="row"><span class="n">${q.label || i + 1}</span>${bubbles}${q.type === 'multi_select' ? '<em>select all</em>' : ''}</div>`;
  }).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title} - answer sheet</title>
<style>body{font-family:Inter,Arial,sans-serif;padding:32px;color:#0f172a}h1{font-size:20px;margin:0 0 4px}p{color:#64748b;margin:0 0 20px}
.meta{display:flex;gap:40px;margin-bottom:24px;font-size:14px}.grid{columns:2;column-gap:48px}
.row{display:flex;align-items:center;gap:10px;padding:7px 0;break-inside:avoid;border-bottom:1px dashed #e2e8f0}
.n{width:28px;font-weight:700;text-align:right}.b{width:24px;height:24px;border:1.5px solid #334155;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:600}
em{font-size:11px;color:#64748b}</style></head><body>
<h1>${title}</h1><p>Answer sheet · fill in one bubble per question (more than one where it says "select all")</p>
<div class="meta"><span>Name: ______________________________</span><span>Date: ______________</span><span>Score: ______ / ${choice.length}</span></div>
<div class="grid">${rows || '<p>This quiz has no multiple-choice questions.</p>'}</div>
<script>window.onload=function(){window.print()}</script></body></html>`;
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) return;
  w.document.write(html);
  w.document.close();
};

export const ExportMenu: React.FC<ExportMenuProps> = ({ setId, title, questions, keyLocked, kind }) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  // Phones get a sheet from the bottom of the screen (a dropdown would run off the edge); larger screens a dropdown
  const [asSheet, setAsSheet] = useState(false);
  useBackHandler(() => setOpen(false), open);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !sheetRef.current?.contains(target)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', escape);
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', escape);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const run = async (item: (typeof ITEMS)[number]) => {
    const id = `${item.format}${item.version || ''}${item.key ?? ''}`;
    setBusy(id);
    setError(null);
    try {
      await downloadExport(setId, item.format, item.version || 'A', item.key ?? true);
      setOpen(false);
    } catch (err) {
      setError(getErrorMessage(err, 'Export failed.'));
    } finally {
      setBusy(null);
    }
  };

  const items = ITEMS.filter(i => !(keyLocked && i.key)).filter(i => !(kind === 'exam' && (i.format === 'kahoot' || i.format === 'anki')));

  const menu = (
    <>
      {/* Printing isn't available inside the phone app - the Word export goes to the share sheet instead */}
      {!isNative && <button onClick={() => { window.print(); setOpen(false); }} className="w-full flex items-start gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 text-left">
        <Printer className="w-4 h-4 mt-0.5 text-slate-500" />
        <span><span className="block text-sm font-semibold text-slate-800">Print / save as PDF</span><span className="block text-[11px] text-slate-400">Show the answers first to include them</span></span>
      </button>}
      {kind === 'quiz' && !isNative && (
        <button onClick={() => { printBubbleSheet(title, questions); setOpen(false); }} className="w-full flex items-start gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 text-left">
          <CircleDot className="w-4 h-4 mt-0.5 text-slate-500" />
          <span><span className="block text-sm font-semibold text-slate-800">Bubble answer sheet</span><span className="block text-[11px] text-slate-400">Printable sheet for the choice questions</span></span>
        </button>
      )}
      {!isNative && <div className="my-1 h-px bg-slate-100" />}
      {items.map(item => {
        const id = `${item.format}${item.version || ''}${item.key ?? ''}`;
        return (
          <button key={id} onClick={() => run(item)} disabled={!!busy} className="w-full flex items-start gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 text-left disabled:opacity-50">
            {busy === id ? <Loader2 className="w-4 h-4 mt-0.5 animate-spin text-primary-600" /> : <item.icon className="w-4 h-4 mt-0.5 text-slate-500" />}
            <span><span className="block text-sm font-semibold text-slate-800">{item.label}</span><span className="block text-[11px] text-slate-400">{item.hint}</span></span>
          </button>
        );
      })}
      {error && <p className="px-3 py-2 text-xs text-rose-600">{error}</p>}
    </>
  );

  return (
    <div ref={ref} className="relative no-print">
      <button onClick={() => { setAsSheet(!window.matchMedia('(min-width: 768px)').matches); setOpen(o => !o); }} aria-expanded={open}
        className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">
        <Download className="w-4 h-4" /> Export <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && !asSheet && (
        <div className="absolute right-0 top-12 z-40 w-80 bg-white rounded-2xl shadow-2xl border border-slate-100 p-1.5 dialog-panel">
          {menu}
        </div>
      )}
      {open && asSheet && createPortal(
        <div className="no-print fixed inset-0 z-[60] flex items-end" role="dialog" aria-modal="true" aria-label="Export">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] animate-fade-in" onClick={() => setOpen(false)} aria-hidden="true" />
          <div ref={sheetRef} data-lenis-prevent
            className="relative w-full max-h-[80dvh] overflow-y-auto rounded-t-3xl bg-white shadow-2xl p-2 pb-[calc(0.75rem+env(safe-area-inset-bottom))] animate-slide-up">
            <div className="flex flex-col items-center pt-1 pb-2">
              <span className="w-10 h-1.5 rounded-full bg-slate-200" />
              <span className="mt-3 text-sm font-bold text-slate-800">Export {kind === 'exam' ? 'exam paper' : 'quiz'}</span>
            </div>
            {menu}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};
