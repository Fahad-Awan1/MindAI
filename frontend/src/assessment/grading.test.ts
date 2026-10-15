import { describe, expect, it } from 'vitest';
import { gradeLocally, isBlankAnswer, normalizeText, parseNumber, textMatches } from './grading';
import { Question } from './types';

const q = (over: Partial<Question>): Question => ({ id: 'q1', type: 'mcq', question: 'Q?', ...over } as Question);

describe('text answers', () => {
  it('normalises case, punctuation and articles', () => {
    expect(normalizeText('  The Mitochondria! ')).toBe('mitochondria');
    expect(normalizeText('a cell-wall.')).toBe('cell-wall');
  });

  it('parses numbers with separators and unicode minus', () => {
    expect(parseNumber('1,250')).toBe(1250);
    expect(parseNumber('−3.5')).toBe(-3.5);
    expect(parseNumber('abc')).toBeNull();
  });

  it('accepts exact, numeric-equal and near-miss spellings', () => {
    expect(textMatches('Photosynthesis', 'photosynthesis')).toBe(true);
    expect(textMatches('2.50', '2.5')).toBe(true);
    expect(textMatches('photosynthesys', 'photosynthesis')).toBe(true);
    expect(textMatches('respiration', 'photosynthesis')).toBe(false);
  });
});

describe('gradeLocally', () => {
  it('grades single choice', () => {
    expect(gradeLocally(q({ type: 'mcq', correct_answer_index: 2 }), 2)).toMatchObject({ score: 1, correct: true });
    expect(gradeLocally(q({ type: 'mcq', correct_answer_index: 2 }), 1)).toMatchObject({ score: 0, correct: false });
  });

  it('gives partial credit for multi-select and penalises wrong picks', () => {
    const multi = q({ type: 'multi_select', correct_indices: [0, 2] });
    expect(gradeLocally(multi, [0, 2]).correct).toBe(true);
    expect(gradeLocally(multi, [0]).score).toBeCloseTo(0.5);
    expect(gradeLocally(multi, [0, 1]).score).toBe(0);
  });

  it('grades matching and ordering with partial credit', () => {
    const matching = q({ type: 'matching', pairs: [[0, 1], [1, 0], [2, 2]] });
    expect(gradeLocally(matching, [1, 0, 2]).score).toBe(1);
    expect(gradeLocally(matching, [1, 2, 0]).score).toBeCloseTo(1 / 3);
    const ordering = q({ type: 'ordering', items: ['a', 'b', 'c', 'd'] });
    expect(gradeLocally(ordering, [0, 1, 2, 3]).correct).toBe(true);
    expect(gradeLocally(ordering, [1, 0, 2, 3]).score).toBeCloseTo(0.75);
  });

  it('treats empty answers as blank (score 0)', () => {
    expect(isBlankAnswer('')).toBe(true);
    expect(isBlankAnswer([])).toBe(true);
    expect(gradeLocally(q({ type: 'mcq', correct_answer_index: 0 }), '' as never).score).toBe(0);
  });
});
