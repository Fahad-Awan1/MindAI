import { ExamPaperV2, Question } from './types';

/** Quiz data in the current schema: old saved quizzes are plain multiple-choice items without id/type. */
export const normalizeQuiz = (data: unknown): Question[] => {
  if (!Array.isArray(data)) return [];
  return data
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item, i) => ({ type: 'mcq', id: `q${i}`, ...item } as Question));
};

/** Exam data in the current schema: old papers have no sections and numeric ids. */
export const normalizeExam = (data: unknown): ExamPaperV2 => {
  const raw = (data && typeof data === 'object' ? data : {}) as Partial<ExamPaperV2>;
  const rawQuestions = (Array.isArray(raw.questions) ? raw.questions : []) as unknown[];
  const questions: Question[] = rawQuestions
    .filter((q): q is Record<string, unknown> => !!q && typeof q === 'object')
    .map((q, i) => ({
      section_id: 'A',
      label: String(i + 1),
      ...q,
      type: (q.type as string) || 'short',
      id: String(q.id ?? i + 1),
    } as Question));
  const sections = raw.sections && raw.sections.length
    ? raw.sections
    : [{ id: 'A', title: 'Written questions', kind: 'short' as const, instructions: 'Answer all questions.', attempt_any: null,
         marks: questions.reduce((s, q) => s + (q.marks || 0), 0), question_ids: questions.map(q => q.id) }];
  return {
    version: raw.version ?? 1,
    title: raw.title || 'Examination',
    difficulty: raw.difficulty,
    total_marks: raw.total_marks ?? sections.reduce((s, x) => s + (x.marks || 0), 0),
    duration_minutes: raw.duration_minutes || 60,
    instructions: raw.instructions,
    header: raw.header ?? null,
    sections,
    questions,
  };
};

/** Seeded shuffle (same seed -> same order), for stable reshuffles and A/B versions. */
export const seededShuffle = <T,>(items: T[], seed: string): T[] => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const rand = () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

/** Shuffle a choice question's options (remapping its answer) so a retake isn't memorised by position. */
export const reshuffleOptions = (q: Question, seed: string): Question => {
  if (!q.options || (q.type !== 'mcq' && q.type !== 'multi_select')) return q;
  const order = seededShuffle(q.options.map((_, i) => i), seed + q.id);
  const options = order.map(i => q.options![i]);
  if (q.type === 'mcq') return { ...q, options, correct_answer_index: order.indexOf(q.correct_answer_index ?? 0) };
  return { ...q, options, correct_indices: (q.correct_indices || []).map(i => order.indexOf(i)).sort((a, b) => a - b) };
};
