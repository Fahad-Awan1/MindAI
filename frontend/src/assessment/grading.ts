import { AnswerValue, Question } from './types';

/**
 * Client-side mirror of the server's deterministic grading (backend/services/assessment/grader.py),
 * used for instant feedback in practice mode. The server's result is always the one that counts.
 */

const ARTICLES = /\b(a|an|the)\b/g;
const NUMBER = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;

export const normalizeText = (text: string): string =>
  (text || '')
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s.-]/g, ' ')
    .replace(ARTICLES, ' ')
    .replace(/^[\s.-]+|[\s.-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export const parseNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value ?? '').trim().replace(/,/g, '').replace('−', '-');
  const match = s.match(/^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?/);
  if (!match) return null;
  const n = parseFloat(match[0]);
  return Number.isFinite(n) ? n : null;
};

/** Similarity ratio like Python's difflib (2*matches / total), via longest common subsequence. */
const similarity = (a: string, b: string): number => {
  if (!a.length && !b.length) return 1;
  const dp = Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return (2 * dp[b.length]) / (a.length + b.length);
};

export const textMatches = (answer: string, accepted: string): boolean => {
  const a = normalizeText(answer);
  const b = normalizeText(accepted);
  if (!a || !b) return false;
  if (a === b) return true;
  if (NUMBER.test(a) && NUMBER.test(b)) {
    const na = parseNumber(a);
    const nb = parseNumber(b);
    if (na !== null && nb !== null && Math.abs(na - nb) <= 1e-9 * Math.max(1, Math.abs(nb))) return true;
  }
  return b.length > 4 && similarity(a, b) >= 0.9;
};

const lisLength = (seq: number[]): number => {
  const tails: number[] = [];
  for (const x of seq) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = x;
  }
  return tails.length;
};

export const isBlankAnswer = (answer: AnswerValue): boolean => {
  if (answer === null || answer === undefined) return true;
  if (typeof answer === 'string') return !answer.trim();
  if (typeof answer === 'number') return answer < 0;
  if (Array.isArray(answer)) {
    return answer.length === 0 || (answer as unknown[]).every(a => a === null || a === -1 || (typeof a === 'string' && !a.trim()));
  }
  return false;
};

export interface LocalGrade {
  score: number;
  correct: boolean;
  /** Needs the AI to judge (free-text short answers) */
  needsAi: boolean;
}

export const gradeLocally = (q: Question, answer: AnswerValue): LocalGrade => {
  const out: LocalGrade = { score: 0, correct: false, needsAi: false };
  if (isBlankAnswer(answer)) return out;
  switch (q.type) {
    case 'mcq':
    case 'true_false':
      out.score = answer === q.correct_answer_index ? 1 : 0;
      break;
    case 'multi_select': {
      const chosen = new Set(answer as number[]);
      const correct = new Set(q.correct_indices || []);
      const hits = [...chosen].filter(i => correct.has(i)).length;
      const wrong = chosen.size - hits;
      out.score = correct.size ? Math.max(0, (hits - wrong) / correct.size) : 0;
      out.correct = chosen.size === correct.size && hits === correct.size;
      return out;
    }
    case 'fill_blank': {
      const given = answer as string[];
      const blanks = q.blanks || [];
      const hits = blanks.filter((b, i) => b.accepted.some(acc => textMatches(String(given[i] ?? ''), acc))).length;
      out.score = blanks.length ? hits / blanks.length : 0;
      break;
    }
    case 'matching': {
      const chosen = answer as number[];
      const pairs = q.pairs || [];
      const hits = pairs.filter(([li, ri]) => chosen[li] === ri).length;
      out.score = pairs.length ? hits / pairs.length : 0;
      break;
    }
    case 'ordering': {
      const order = answer as number[];
      const n = (q.items || []).length;
      const perfect = order.every((v, i) => v === i) && order.length === n;
      out.score = perfect ? 1 : n ? Math.round((lisLength(order) / n) * 1000) / 1000 : 0;
      break;
    }
    case 'numeric': {
      const value = parseNumber(answer);
      if (value !== null && typeof q.answer === 'number') {
        out.score = Math.abs(value - q.answer) <= (q.tolerance || 0) + 1e-9 * Math.max(1, Math.abs(q.answer)) ? 1 : 0;
      }
      break;
    }
    case 'short_answer':
      if (textMatches(String(answer), q.model_answer || '')) out.score = 1;
      else out.needsAi = true;
      break;
    default:
      out.needsAi = true;
  }
  out.correct = out.score >= 0.999;
  return out;
};

/** The correct answer as readable text. */
export const answerText = (q: Question): string => {
  const options = q.options || [];
  switch (q.type) {
    case 'mcq':
    case 'true_false':
      return options[q.correct_answer_index ?? -1] ?? '';
    case 'multi_select':
      return (q.correct_indices || []).map(i => options[i]).join('; ');
    case 'fill_blank':
      return (q.blanks || []).map(b => b.accepted[0]).join('; ');
    case 'matching':
      return (q.pairs || []).map(([li, ri]) => `${q.left?.[li]} → ${q.right?.[ri]}`).join('; ');
    case 'ordering':
      return (q.items || []).join(' → ');
    case 'numeric':
      return `${q.answer}${q.unit ? ` ${q.unit}` : ''}`;
    case 'short_answer':
      return q.model_answer || '';
    default:
      return q.answer_key || '';
  }
};

/** A blank answer of the right shape for a question. */
export const emptyAnswer = (q: Question): AnswerValue => {
  switch (q.type) {
    case 'multi_select':
      return [];
    case 'fill_blank':
      return (q.blanks || []).map(() => '');
    case 'matching':
      return (q.left || []).map(() => -1);
    case 'ordering':
      return null;
    case 'numeric':
    case 'short_answer':
    case 'short':
    case 'long':
      return '';
    default:
      return -1;
  }
};
