import { describe, expect, it } from 'vitest';
import { registry } from '../src/modules/questions/engine/registry.js';
import {
  levenshtein,
  normalizeText,
  parseNumeric,
  textMatches,
} from '../src/modules/questions/engine/normalize.js';
import type { EngineQuestion } from '../src/modules/questions/engine/types.js';

const q = (type: string, content: Record<string, unknown>, correctAnswer: unknown, configuration: Record<string, unknown> = {}): EngineQuestion =>
  ({ type, content, correctAnswer, configuration });

const opts = (...texts: string[]) => texts.map((t, i) => ({ id: `o${i + 1}`, text: t }));

describe('QuestionTypeRegistry', () => {
  it('registers all 80 required question types', () => {
    const required = [
      'multiple_choice','multiple_select','true_false','yes_no','fill_blank','short_answer','long_answer',
      'numeric_answer','ordering','ranking','matching','pairing','categorization','drag_drop','image_choice',
      'image_multiple_choice','identify_image','image_hotspot','map_question','audio_question','listen_and_answer',
      'video_question','watch_and_answer','sequence','timeline','crossword','word_search','word_scramble','anagram',
      'hangman','missing_letters','spelling','sentence_completion','sentence_ordering','text_reconstruction',
      'code_question','formula_question','calculation','equation','fraction','percentage','matrix_grid','logic_puzzle',
      'pattern_recognition','odd_one_out','comparison','estimate','slider_answer','scale_answer','ranking_multiple_items',
      'select_from_grid','table_question','chart_question','graph_interpretation','text_plus_question',
      'reading_comprehension','passage_based','case_study','scenario_question','flashcard','confidence_based','poll',
      'survey','personality_question','ranking_poll','open_text','voice_answer','speaking_question',
      'handwriting_drawing','coordinate_question','color_question','memory_question','sequence_memory',
      'progressive_question','adaptive_question','multi_part','compound_question','branching_question',
      'random_question','randomized_options',
    ];
    expect(required).toHaveLength(80);
    for (const type of required) expect(registry.has(type), `missing type ${type}`).toBe(true);
  });

  it('rejects unknown types', () => {
    expect(() => registry.getSpec('nope')).toThrow();
  });
});

describe('single choice scoring', () => {
  const mc = q('multiple_choice', { prompt: { en: 'Q?' }, options: opts('A', 'B', 'C') }, 'o2');
  it('scores correct/incorrect', () => {
    expect(registry.score('multiple_choice', mc, 'o2').outcome).toBe('correct');
    expect(registry.score('multiple_choice', mc, 'o1').outcome).toBe('incorrect');
    expect(registry.score('multiple_choice', mc, null).outcome).toBe('incorrect');
    expect(registry.score('multiple_choice', mc, { garbage: true }).outcome).toBe('incorrect');
  });
  it('validates option references', () => {
    expect(registry.validate('multiple_choice', mc)).toHaveLength(0);
    expect(registry.validate('multiple_choice', q('multiple_choice', { prompt: 'Q', options: opts('A', 'B') }, 'o9'))).not.toHaveLength(0);
    expect(registry.validate('multiple_choice', q('multiple_choice', { prompt: 'Q', options: opts('A', 'A') }, 'o1'))).not.toHaveLength(0);
    expect(registry.validate('multiple_choice', q('multiple_choice', { prompt: '', options: opts('A', 'B') }, 'o1'))).not.toHaveLength(0);
  });
  it('present strips the correct answer and shuffles', () => {
    const presented = registry.present('multiple_choice', mc, () => 0.4);
    expect(JSON.stringify(presented.content)).not.toContain('correctAnswer');
    expect((presented.content.options as unknown[]).length).toBe(3);
  });
});

describe('multi choice scoring (partial credit + negative marking)', () => {
  const ms = q('multiple_select', { prompt: 'Q', options: opts('A', 'B', 'C', 'D') }, ['o1', 'o2', 'o3'], { partialCredit: true });
  it('full credit for exact set', () => {
    expect(registry.score('multiple_select', ms, ['o1', 'o2', 'o3'])).toMatchObject({ outcome: 'correct', ratio: 1 });
  });
  it('partial credit (3 of 4 elements → 2/3 after logic)', () => {
    const r = registry.score('multiple_select', ms, ['o1', 'o2']);
    expect(r.outcome).toBe('partial');
    expect(r.ratio).toBeCloseTo(2 / 3);
  });
  it('wrong selections cancel hits', () => {
    const r = registry.score('multiple_select', ms, ['o1', 'o4']);
    expect(r.ratio).toBeCloseTo(0);
    expect(r.outcome).toBe('incorrect');
  });
  it('no partial credit when disabled', () => {
    const strict = q('multiple_select', ms.content, ms.correctAnswer, { partialCredit: false });
    expect(registry.score('multiple_select', strict, ['o1', 'o2']).outcome).toBe('incorrect');
  });
});

describe('text scoring & normalization', () => {
  it('normalizes Arabic diacritics and variants', () => {
    expect(normalizeText('مَكَّةُ')).toBe(normalizeText('مكه'));
    expect(normalizeText('القُرْآن')).toBe(normalizeText('القران'));
  });
  it('case/whitespace-insensitive matching', () => {
    const t = q('short_answer', { prompt: 'Q' }, { accepted: ['Leonardo da Vinci'] });
    expect(registry.score('short_answer', t, '  leonardo DA vinci ').outcome).toBe('correct');
  });
  it('typo tolerance via levenshtein', () => {
    expect(levenshtein('silent', 'silant')).toBe(1);
    const t = q('short_answer', { prompt: 'Q' }, { accepted: ['silent'] }); // default tolerance 1
    expect(registry.score('short_answer', t, 'silant').outcome).toBe('correct');
    expect(registry.score('short_answer', t, 'sixxnt').outcome).toBe('incorrect');
  });
  it('empty answer is skipped', () => {
    const t = q('fill_blank', { prompt: 'Q' }, { accepted: ['x'] });
    expect(registry.score('fill_blank', t, '   ').outcome).toBe('skipped');
  });
  it('textMatches contains mode', () => {
    expect(textMatches('love', 'a story about love and loss', { matchMode: 'contains' })).toBe(true);
  });
});

describe('numeric scoring', () => {
  it('parses fractions, percents, arabic digits, commas', () => {
    expect(parseNumeric('3/4')).toBe(0.75);
    expect(parseNumeric('75%')).toBe(0.75);
    expect(parseNumeric('١٢')).toBe(12);
    expect(parseNumeric('1,5')).toBe(1.5);
    expect(parseNumeric('abc')).toBeNull();
    expect(parseNumeric('1/0')).toBeNull();
  });
  it('scores with tolerance', () => {
    const n = q('estimate', { prompt: 'Q' }, { value: 100, tolerancePercent: 0.1 });
    expect(registry.score('estimate', n, 105).outcome).toBe('correct');
    expect(registry.score('estimate', n, 89).outcome).toBe('incorrect');
  });
  it('fraction answer formats accepted', () => {
    const n = q('fraction', { prompt: 'Q' }, { value: 0.75 });
    expect(registry.score('fraction', n, '3/4').outcome).toBe('correct');
    expect(registry.score('fraction', n, 0.75).outcome).toBe('correct');
  });
  it('unparseable submitted answer is incorrect, empty is skipped', () => {
    const n = q('calculation', { prompt: 'Q' }, 5);
    expect(registry.score('calculation', n, 'o1').outcome).toBe('incorrect');
    expect(registry.score('calculation', n, '').outcome).toBe('skipped');
    expect(registry.score('calculation', n, null).outcome).toBe('skipped');
  });
});

describe('ordering scoring', () => {
  const items = [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }, { id: 'd', text: 'D' }];
  const o = q('ordering', { prompt: 'Q', items }, ['a', 'b', 'c', 'd'], { partialCredit: true });
  it('exact order is correct', () => {
    expect(registry.score('ordering', o, ['a', 'b', 'c', 'd']).outcome).toBe('correct');
  });
  it('partial positions', () => {
    const r = registry.score('ordering', o, ['a', 'b', 'd', 'c']);
    expect(r.outcome).toBe('partial');
    expect(r.ratio).toBe(0.5);
  });
  it('never presents items in the correct order', () => {
    for (let i = 0; i < 20; i++) {
      const p = registry.present('ordering', o, Math.random);
      const ids = (p.content.items as Array<{ id: string }>).map((x) => x.id).join(',');
      expect(ids).not.toBe('a,b,c,d');
    }
  });
  it('validates permutation', () => {
    expect(registry.validate('ordering', q('ordering', { prompt: 'Q', items }, ['a', 'b']))).not.toHaveLength(0);
  });
});

describe('matching & categorization', () => {
  const m = q('matching', {
    prompt: 'Q',
    left: [{ id: 'l1', text: 'Japan' }, { id: 'l2', text: 'Egypt' }],
    right: [{ id: 'r1', text: 'Tokyo' }, { id: 'r2', text: 'Cairo' }],
  }, { l1: 'r1', l2: 'r2' }, { partialCredit: true });
  it('scores pairs with partial credit', () => {
    expect(registry.score('matching', m, { l1: 'r1', l2: 'r2' }).outcome).toBe('correct');
    expect(registry.score('matching', m, { l1: 'r1', l2: 'r1' })).toMatchObject({ outcome: 'partial', ratio: 0.5 });
    expect(registry.score('matching', m, {}).outcome).toBe('skipped');
  });
  const cat = q('categorization', {
    prompt: 'Q',
    items: [{ id: 'i1', text: 'Eagle' }, { id: 'i2', text: 'Salmon' }],
    categories: [{ id: 'c1', text: 'Bird' }, { id: 'c2', text: 'Fish' }],
  }, { i1: 'c1', i2: 'c2' }, { partialCredit: true });
  it('categorization scoring', () => {
    expect(registry.score('categorization', cat, { i1: 'c1', i2: 'c2' }).outcome).toBe('correct');
    expect(registry.score('categorization', cat, { i1: 'c2', i2: 'c2' }).ratio).toBe(0.5);
  });
});

describe('hotspot scoring', () => {
  const h = q('image_hotspot', { prompt: 'Q' }, { regions: [{ shape: 'circle', x: 0.5, y: 0.5, r: 0.1 }, { shape: 'rect', x: 0, y: 0, w: 0.2, h: 0.2 }] });
  it('hits inside region', () => {
    expect(registry.score('image_hotspot', h, { x: 0.52, y: 0.48 }).outcome).toBe('correct');
    expect(registry.score('image_hotspot', h, { x: 0.1, y: 0.1 }).outcome).toBe('correct');
    expect(registry.score('image_hotspot', h, { x: 0.9, y: 0.9 }).outcome).toBe('incorrect');
    expect(registry.score('image_hotspot', h, {}).outcome).toBe('skipped');
  });
});

describe('grid puzzles', () => {
  const cw = q('crossword', { prompt: 'Q', slots: [] }, { entries: { a1: 'night', a2: 'ice' } }, { partialCredit: true });
  it('crossword keyed entries with partial credit', () => {
    expect(registry.score('crossword', cw, { entries: { a1: 'NIGHT', a2: 'ice' } }).outcome).toBe('correct');
    expect(registry.score('crossword', cw, { entries: { a1: 'night', a2: 'water' } }).ratio).toBe(0.5);
  });
  const ws = q('word_search', { prompt: 'Q' }, { words: ['cat', 'dog', 'bird'] }, { partialCredit: true });
  it('word search found list', () => {
    expect(registry.score('word_search', ws, { found: ['cat', 'dog', 'bird'] }).outcome).toBe('correct');
    expect(registry.score('word_search', ws, { found: ['cat'] }).ratio).toBeCloseTo(1 / 3);
  });
});

describe('special families', () => {
  it('confidence-based rewards confident correct answers', () => {
    const c = q('confidence_based', { prompt: 'Q', options: opts('A', 'B') }, 'o1');
    const high = registry.score('confidence_based', c, { optionId: 'o1', confidence: 1 });
    const low = registry.score('confidence_based', c, { optionId: 'o1', confidence: 0 });
    expect(high.ratio).toBe(1);
    expect(low.ratio).toBe(0.5);
    expect(registry.score('confidence_based', c, { optionId: 'o2', confidence: 1 }).ratio).toBe(0);
  });
  it('polls are never scored', () => {
    const p = q('poll', { prompt: 'Q', options: opts('A', 'B') }, null);
    expect(registry.isScored('poll')).toBe(false);
    expect(registry.score('poll', p, 'o1').outcome).toBe('correct'); // participation only
    expect(registry.score('poll', p, null).outcome).toBe('skipped');
  });
  it('submission with keywords auto-scores', () => {
    const s = q('open_text', { prompt: 'Q' }, { keywords: ['love', 'loss'] }, { partialCredit: true });
    expect(registry.score('open_text', s, 'a tale of love and loss').ratio).toBe(1);
    expect(registry.score('open_text', s, 'a tale of love').ratio).toBe(0.5);
  });
  it('flashcard self-assessment', () => {
    const f = q('flashcard', { prompt: 'Q' }, { back: 'answer' });
    expect(registry.score('flashcard', f, { knew: true }).outcome).toBe('correct');
    expect(registry.score('flashcard', f, { knew: false }).outcome).toBe('incorrect');
  });
});

describe('composite questions', () => {
  const comp = q('multi_part', {
    prompt: 'Rectangle 8x5',
    parts: [
      { id: 'area', type: 'calculation', content: { prompt: 'Area?' } },
      { id: 'perimeter', type: 'calculation', content: { prompt: 'Perimeter?' } },
    ],
  }, { area: 40, perimeter: 26 });
  it('scores parts with weighted average', () => {
    expect(registry.score('multi_part', comp, { area: 40, perimeter: 26 }).outcome).toBe('correct');
    expect(registry.score('multi_part', comp, { area: 40, perimeter: 1 })).toMatchObject({ outcome: 'partial', ratio: 0.5 });
    expect(registry.score('multi_part', comp, {}).outcome).toBe('skipped');
  });
  it('validates sub-parts and rejects nested composites', () => {
    expect(registry.validate('multi_part', comp)).toHaveLength(0);
    const nested = q('multi_part', { prompt: 'Q', parts: [{ id: 'x', type: 'multi_part', content: { prompt: 'inner', parts: [{ id: 'y', type: 'calculation', content: { prompt: 'Q' } }] } }] }, { x: {} });
    expect(registry.validate('multi_part', nested)).not.toHaveLength(0);
  });
  it('present sanitizes sub-part answers', () => {
    const p = registry.present('multi_part', comp, Math.random);
    expect(JSON.stringify(p.content)).not.toContain('"40"');
  });
  it('scoring never throws on malformed answers', () => {
    expect(() => registry.score('multi_part', comp, 'garbage')).not.toThrow();
    expect(() => registry.score('multi_part', comp, [1, 2, 3])).not.toThrow();
  });
});
