import React, { useRef } from 'react';
import { ImagePlus, Plus, Trash2, X } from 'lucide-react';
import { PaperHeader as Header, PaperHeaderField } from '../../assessment/types';

const DEFAULTS_KEY = 'mindai.examHeader';

export const HEADER_TEMPLATE: Header = {
  logo: null,
  show_logo: true,
  institution: 'University Name',
  campus: 'Campus',
  department: '(Department of ...)',
  exam_name: 'Terminal Examination',
  fields: [
    { label: 'Course Title', value: '' },
    { label: 'Course Code', value: '' },
    { label: 'Course Instructor', value: '' },
    { label: 'Credit Hours', value: '' },
    { label: 'Programme', value: '' },
    { label: 'Semester', value: '' },
    { label: 'Batch / Section', value: '' },
    { label: 'Date', value: '' },
    { label: 'Time Allowed', value: '', auto: 'duration' },
    { label: 'Maximum Marks', value: '', auto: 'marks' },
    { label: "Student's Name", value: '' },
    { label: 'Reg. No.', value: '' },
  ],
};

/** The header saved as "my default" (reused for new papers), or the blank template. */
export const defaultHeader = (): Header => {
  try {
    const raw = window.localStorage.getItem(DEFAULTS_KEY);
    if (raw) return { ...HEADER_TEMPLATE, ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return HEADER_TEMPLATE;
};

export const saveDefaultHeader = (header: Header) => {
  try {
    // Course-specific details are cleared so the default works for any paper
    const generic = { ...header, fields: header.fields.map(f => ({ ...f, value: '' })) };
    window.localStorage.setItem(DEFAULTS_KEY, JSON.stringify(generic));
    return true;
  } catch {
    return false;
  }
};

/** Shrink an uploaded logo to at most 240px and return it as a PNG data URL. */
const readLogo = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the image.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not an image.'));
      img.onload = () => {
        const scale = Math.min(1, 240 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });

interface PaperHeaderProps {
  header: Header;
  editing: boolean;
  duration: number;
  totalMarks: number;
  instructions: string[];
  onChange?: (header: Header) => void;
  onInstructionsChange?: (lines: string[]) => void;
  onError?: (message: string) => void;
}

/** Sample text from the template is selected on focus, so typing replaces it instead of mixing into it. */
const SAMPLE_TEXT = new Set([HEADER_TEMPLATE.institution, HEADER_TEMPLATE.campus, HEADER_TEMPLATE.department, 'New field']);
const selectSample = (e: React.FocusEvent<HTMLInputElement>) => {
  const el = e.currentTarget;
  if (SAMPLE_TEXT.has(el.value)) setTimeout(() => el.select(), 0);
};

const fieldValue = (f: PaperHeaderField, duration: number, marks: number) =>
  f.value || (f.auto === 'duration' ? `${duration} Minutes` : f.auto === 'marks' ? String(marks) : '');

/** University-style exam header (logo, institution, details table, instructions, exam name), editable in place. */
export const PaperHeader: React.FC<PaperHeaderProps> = ({ header, editing, duration, totalMarks, instructions, onChange, onInstructionsChange, onError }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Header>) => onChange?.({ ...header, ...patch });
  const setField = (i: number, patch: Partial<PaperHeaderField>) =>
    set({ fields: header.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const line = 'w-full bg-transparent text-center border-0 border-b border-dashed border-sky-300 focus:border-sky-600 focus:ring-0 px-1';
  const pairs: PaperHeaderField[][] = [];
  for (let i = 0; i < header.fields.length; i += 2) pairs.push(header.fields.slice(i, i + 2));

  return (
    <div className="mb-6">
      {/* Logo + institution */}
      <div className="flex items-center gap-4 md:gap-6">
        <div className="relative w-20 h-20 md:w-24 md:h-24 flex-shrink-0">
          {header.logo && header.show_logo !== false ? (
            <img src={header.logo} alt="Logo" className="w-full h-full object-contain" />
          ) : editing ? (
            <button type="button" onClick={() => fileRef.current?.click()} className="no-print w-full h-full rounded-2xl border-2 border-dashed border-sky-300 text-sky-600 flex flex-col items-center justify-center gap-1 text-[10px] font-sans font-bold hover:bg-sky-50">
              <ImagePlus className="w-6 h-6" /> Add logo
            </button>
          ) : null}
          {editing && header.logo && (
            <div className="no-print absolute -bottom-2 left-1/2 -translate-x-1/2 flex gap-1 font-sans">
              <button type="button" onClick={() => fileRef.current?.click()} className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-[10px] font-bold text-slate-600 shadow-sm">Change</button>
              <button type="button" onClick={() => set({ logo: null })} className="p-1.5 rounded bg-white border border-slate-200 text-slate-500 shadow-sm" aria-label="Remove logo"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              set({ logo: await readLogo(file), show_logo: true });
            } catch (err) {
              onError?.((err as Error).message);
            }
          }} />
        </div>
        <div className="flex-1 text-center">
          {editing ? (
            <div className="space-y-1">
              <input value={header.institution} onChange={e => set({ institution: e.target.value })} onFocus={selectSample} placeholder="Institution" className={`${line} text-xl md:text-2xl font-bold`} />
              <input value={header.campus} onChange={e => set({ campus: e.target.value })} onFocus={selectSample} placeholder="Campus (optional)" className={`${line} text-base md:text-lg font-bold`} />
              <input value={header.department} onChange={e => set({ department: e.target.value })} onFocus={selectSample} placeholder="Department (optional)" className={`${line} text-base md:text-lg font-bold`} />
            </div>
          ) : (
            <>
              {header.institution && <p className="text-xl md:text-[1.7rem] font-bold leading-tight">{header.institution}</p>}
              {header.campus && <p className="text-base md:text-xl font-bold">{header.campus}</p>}
              {header.department && <p className="text-base md:text-xl font-bold">{header.department}</p>}
            </>
          )}
        </div>
        {/* Balances the logo so the titles stay centred */}
        <div className="w-20 md:w-24 flex-shrink-0 hidden sm:block" />
      </div>
      <div className="mt-4 border-t-[3px] border-black" />

      {/* Details table */}
      {/* Four columns of details: scroll sideways on a narrow phone rather than squeezing every cell */}
      <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[30rem] md:min-w-0 border-collapse border border-black text-[13px] md:text-sm">
        <tbody>
          {pairs.map((pair, r) => (
            <tr key={r}>
              {pair.map((f, c) => {
                const i = r * 2 + c;
                return (
                  <React.Fragment key={i}>
                    <td className="border border-black px-1.5 py-0.5 font-bold w-[17%] align-top">
                      {editing ? <input value={f.label} onChange={e => setField(i, { label: e.target.value })} onFocus={selectSample} className="w-full bg-transparent border-0 p-0 font-bold focus:ring-0 text-[13px]" /> : `${f.label}:`}
                    </td>
                    <td className="border border-black px-1.5 py-0.5 w-[33%] align-top">
                      {editing ? (
                        <span className="flex items-center gap-1">
                          <input value={f.value} onChange={e => setField(i, { value: e.target.value })}
                            placeholder={f.auto === 'duration' ? `${duration} Minutes (auto)` : f.auto === 'marks' ? `${totalMarks} (auto)` : ''}
                            className="w-full bg-transparent border-0 p-0 focus:ring-0 text-[13px] placeholder:text-slate-400" />
                          <button type="button" onClick={() => set({ fields: header.fields.filter((_, j) => j !== i) })} className="no-print p-1.5 -m-1 text-slate-300 hover:text-rose-500" aria-label={`Remove ${f.label}`}><Trash2 className="w-3.5 h-3.5" /></button>
                        </span>
                      ) : fieldValue(f, duration, totalMarks)}
                    </td>
                  </React.Fragment>
                );
              })}
              {pair.length === 1 && <td colSpan={2} className="border border-black" />}
            </tr>
          ))}
          <tr>
            <td colSpan={4} className="border border-black px-1.5 py-1">
              <p className="font-bold underline">Important Instructions / Guidelines:</p>
              {editing ? (
                <textarea value={instructions.join('\n')} onChange={e => onInstructionsChange?.(e.target.value.split('\n'))} rows={3}
                  placeholder="One instruction per line" className="w-full mt-1 bg-transparent border border-dashed border-sky-300 rounded p-1 italic text-[13px] focus:ring-0 focus:border-sky-600" />
              ) : (
                instructions.filter(Boolean).map((t, k) => <p key={k} className="italic pl-3">{t}</p>)
              )}
            </td>
          </tr>
        </tbody>
      </table>
      </div>
      {editing && (
        <button type="button" onClick={() => set({ fields: [...header.fields, { label: 'New field', value: '' }] })}
          className="no-print mt-2 flex items-center gap-1 text-xs font-sans font-bold text-sky-700 hover:underline"><Plus className="w-3.5 h-3.5" /> Add a detail row</button>
      )}

      {/* Exam name */}
      <div className="text-center mt-3">
        {editing ? (
          <input value={header.exam_name} onChange={e => set({ exam_name: e.target.value })} placeholder="e.g. Terminal Examination FALL-2025" className={`${line} text-lg font-bold underline max-w-md`} />
        ) : header.exam_name && <p className="text-lg font-bold underline">{header.exam_name}</p>}
      </div>
    </div>
  );
};
