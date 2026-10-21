import { ProjectColor } from '../../types';

/** Full class names per project colour (written out so Tailwind keeps them) */
export const PROJECT_COLORS: Record<ProjectColor, { dot: string; soft: string; text: string; ring: string; gradient: string }> = {
  indigo: { dot: 'bg-indigo-500', soft: 'bg-indigo-50', text: 'text-indigo-700', ring: 'ring-indigo-500', gradient: 'from-indigo-500 to-violet-600' },
  violet: { dot: 'bg-violet-500', soft: 'bg-violet-50', text: 'text-violet-700', ring: 'ring-violet-500', gradient: 'from-violet-500 to-fuchsia-600' },
  sky: { dot: 'bg-sky-500', soft: 'bg-sky-50', text: 'text-sky-700', ring: 'ring-sky-500', gradient: 'from-sky-500 to-blue-600' },
  emerald: { dot: 'bg-emerald-500', soft: 'bg-emerald-50', text: 'text-emerald-700', ring: 'ring-emerald-500', gradient: 'from-emerald-500 to-teal-600' },
  amber: { dot: 'bg-amber-500', soft: 'bg-amber-50', text: 'text-amber-700', ring: 'ring-amber-500', gradient: 'from-amber-500 to-orange-600' },
  rose: { dot: 'bg-rose-500', soft: 'bg-rose-50', text: 'text-rose-700', ring: 'ring-rose-500', gradient: 'from-rose-500 to-pink-600' },
  slate: { dot: 'bg-slate-500', soft: 'bg-slate-100', text: 'text-slate-700', ring: 'ring-slate-500', gradient: 'from-slate-600 to-slate-800' },
};

export const COLOR_NAMES = Object.keys(PROJECT_COLORS) as ProjectColor[];

export const projectColor = (color: string | null | undefined) => PROJECT_COLORS[(color as ProjectColor)] ?? PROJECT_COLORS.indigo;
