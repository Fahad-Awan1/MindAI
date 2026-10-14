import { StudyActivity, StudySet } from '../types';

export type QuizQuestionType =
  | 'mcq' | 'multi_select' | 'true_false' | 'fill_blank' | 'matching' | 'ordering' | 'numeric' | 'short_answer';
export type QuestionType = QuizQuestionType | 'short' | 'long';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type DifficultySetting = Difficulty | 'mixed';
export type Bloom = 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
export type BloomPreset = 'recall' | 'balanced' | 'higher';

export interface QuestionSource {
  document_id: string;
  document_title: string;
  location: string;
  text: string;
}

export interface MarkingPoint {
  point: string;
  marks: number;
}

/** One question of any type (fields depend on `type`). */
export interface Question {
  id: string;
  type: QuestionType;
  question: string;
  topic?: string | null;
  difficulty?: Difficulty;
  bloom?: Bloom;
  explanation?: string;
  hint?: string;
  source?: QuestionSource;
  // mcq / multi_select / true_false
  options?: string[];
  correct_answer_index?: number;
  correct_indices?: number[];
  correct_bool?: boolean;
  // fill_blank
  blanks?: { accepted: string[] }[];
  // matching
  left?: string[];
  right?: string[];
  pairs?: [number, number][];
  // ordering (correct order)
  items?: string[];
  // numeric
  answer?: number;
  tolerance?: number;
  unit?: string;
  // short_answer
  model_answer?: string;
  key_points?: string[];
  // exam
  marks?: number;
  answer_key?: string;
  marking_scheme?: MarkingPoint[];
  section_id?: string;
  parent_id?: string;
  parent_stem?: string;
  label?: string;
}

/**
 * The answer a student gives, by type:
 * mcq/true_false: option index · multi_select: indices · fill_blank: one string per blank ·
 * matching: chosen right index per left item (-1 = none) · ordering: item indices in the placed order ·
 * numeric/short_answer/short/long: text
 */
export type AnswerValue = number | number[] | string | string[] | null;

export interface ExamSection {
  id: string;
  title: string;
  kind: 'objective' | 'short' | 'long';
  instructions: string;
  attempt_any: number | null;
  marks: number;
  question_ids: string[];
}

export interface PaperHeaderField {
  label: string;
  value: string;
  /** Filled in automatically from the paper when left blank */
  auto?: 'duration' | 'marks';
}

export interface PaperHeader {
  logo: string | null;
  show_logo?: boolean;
  institution: string;
  campus: string;
  department: string;
  exam_name: string;
  fields: PaperHeaderField[];
}

export interface ExamPaperV2 {
  header?: PaperHeader | null;
  version: number;
  title: string;
  difficulty?: string;
  total_marks: number;
  duration_minutes: number;
  instructions?: string[];
  sections: ExamSection[];
  questions: Question[];
}

export interface BlueprintSection {
  kind: 'objective' | 'short' | 'long';
  count: number;
  marks_each: number;
  attempt_any?: number | null;
  subparts?: boolean;
  title?: string;
}

export interface QuizStreamRequest {
  document_ids: string[];
  count: number;
  types: QuizQuestionType[];
  difficulty: DifficultySetting;
  bloom: BloomPreset | Record<string, number>;
  topics?: string[];
  sections?: string[];
  focus_weak_topics?: boolean;
  title?: string;
}

export interface ExamStreamRequest {
  document_ids: string[];
  sections?: BlueprintSection[];
  num_questions?: number;
  layout?: 'mixed' | 'objective' | 'short' | 'long';
  difficulty: DifficultySetting;
  bloom: BloomPreset | Record<string, number>;
  duration_minutes?: number | null;
  topics?: string[];
  chapters?: string[];
  title?: string;
  style_notes?: string;
}

/** Events streamed while questions are generated. */
export type GenerationEvent =
  | { type: 'plan'; total: number; batches?: number; focus_topics?: string[]; sections?: unknown[]; total_marks?: number; duration_minutes?: number }
  | { type: 'progress'; batch: number; of: number; topping_up?: number }
  | { type: 'waiting'; seconds: number }
  | { type: 'section'; section: string; kind: string; count: number }
  | { type: 'question'; index: number; question: Question }
  | { type: 'warning'; message: string }
  | { type: 'done'; set: StudySet<unknown> };

export type QuizMode = 'practice' | 'test' | 'adaptive' | 'speed' | 'survival' | 'review';

export interface ResponseItem {
  qid: string;
  answer: AnswerValue;
  time_ms: number;
  confidence: 1 | 2 | 3 | null;
  flagged: boolean;
  hints_used: number;
  fifty_fifty: boolean;
}

export interface ItemResult {
  qid: string;
  score: number;
  correct: boolean;
  feedback: string;
  expected: string;
}

export interface Breakdown {
  label: string;
  score: number;
  total: number;
  correct: number;
  pct: number;
}

export interface AttemptResult {
  activity: StudyActivity;
  results: ItemResult[];
  score: number;
  total: number;
  score_pct: number;
  previous_best_pct: number | null;
  by_topic: Breakdown[];
  by_bloom: Breakdown[];
  by_type: Breakdown[];
  by_difficulty: Breakdown[];
}

export interface AttemptHistoryItem {
  id: string;
  created_at: number;
  correct: number;
  total: number;
  score_pct: number;
  mode: string;
  duration_ms: number | null;
  results: ItemResult[] | null;
  responses: ResponseItem[] | null;
  answers: number[] | null;
}

export const TYPE_LABELS: Record<QuestionType, string> = {
  mcq: 'Multiple choice',
  multi_select: 'Select all',
  true_false: 'True / false',
  fill_blank: 'Fill the blank',
  matching: 'Matching',
  ordering: 'Ordering',
  numeric: 'Numeric',
  short_answer: 'Short answer',
  short: 'Short answer',
  long: 'Long answer',
};

export const BLOOM_LABELS: Record<Bloom, string> = {
  remember: 'Remember',
  understand: 'Understand',
  apply: 'Apply',
  analyze: 'Analyse',
  evaluate: 'Evaluate',
  create: 'Create',
};

// ---------------------------------------------------------------------------
// Exam room
// ---------------------------------------------------------------------------

export interface QuestionMark {
  awarded_marks: number;
  max_marks: number;
  feedback: string;
  missing_points: string[];
  points: { point: string; awarded: number; evidence: string }[];
  error?: boolean;
}

export interface MarkBreakdown {
  label: string;
  awarded: number;
  max: number;
  pct: number;
}

export interface ExamReport {
  sections: { id: string; title: string; awarded: number; max: number }[];
  total_awarded: number;
  total_marks: number;
  pct: number;
  grade: string;
  by_topic: MarkBreakdown[];
  by_bloom: MarkBreakdown[];
  time_spent_ms: number | null;
  duration_minutes: number | null;
  readiness: number;
  next_steps: string[];
}

export interface ExamAttempt {
  id: string;
  study_set_id: string;
  status: 'in_progress' | 'grading' | 'graded';
  started_at: number;
  deadline_at: number | null;
  submitted_at: number | null;
  time_spent_ms: number | null;
  late: boolean;
  total_awarded: number | null;
  total_marks: number | null;
  answers: Record<string, string | number> | null;
  grading: Record<string, QuestionMark> | null;
  report: ExamReport | null;
  remarks: { qid: string; reason: string; before: number; after: number; at: number }[];
  server_now: number;
}

export type MarkingEvent =
  | { type: 'start'; total: number; late: boolean }
  | { type: 'grading'; qid: string }
  | { type: 'graded'; qid: string; result: QuestionMark }
  | { type: 'waiting'; seconds: number }
  | { type: 'warning'; message: string }
  | { type: 'summary'; report: ExamReport }
  | { type: 'done'; attempt: ExamAttempt };
