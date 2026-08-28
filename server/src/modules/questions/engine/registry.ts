/**
 * QuestionTypeRegistry — maps every supported question type id to its
 * family (validation + scoring + presentation) and behavioral flags.
 * Adding a new type = one registration line (plus a renderer on the client).
 */
import { baseFamilies, makeCompositeFamily } from './families.js';
import {
  EngineQuestion,
  PresentedQuestion,
  QuestionFamily,
  QuestionTypeSpec,
  ScoreResult,
} from './types.js';

class QuestionTypeRegistry {
  private families = new Map<string, QuestionFamily>();
  private specs = new Map<string, QuestionTypeSpec>();

  registerFamily(family: QuestionFamily): void {
    this.families.set(family.id, family);
  }

  register(spec: QuestionTypeSpec): void {
    if (!this.families.has(spec.family)) throw new Error(`Unknown family ${spec.family} for type ${spec.id}`);
    this.specs.set(spec.id, spec);
  }

  has(type: string): boolean {
    return this.specs.has(type);
  }

  getSpec(type: string): QuestionTypeSpec {
    const spec = this.specs.get(type);
    if (!spec) throw new Error(`Unknown question type: ${type}`);
    return spec;
  }

  listTypes(): QuestionTypeSpec[] {
    return [...this.specs.values()];
  }

  private prepared(type: string, q: EngineQuestion): { spec: QuestionTypeSpec; family: QuestionFamily; q: EngineQuestion } {
    const spec = this.getSpec(type);
    const family = this.families.get(spec.family)!;
    return {
      spec,
      family,
      q: { ...q, configuration: { ...(spec.defaults ?? {}), ...q.configuration } },
    };
  }

  validate(type: string, q: EngineQuestion): string[] {
    const { family, q: pq } = this.prepared(type, q);
    return family.validate(pq);
  }

  score(type: string, q: EngineQuestion, answer: unknown): ScoreResult {
    const { spec, family, q: pq } = this.prepared(type, q);
    if (!spec.scored) return this.families.get('unscored')!.score(pq, answer);
    return family.score(pq, answer);
  }

  present(type: string, q: EngineQuestion, rng: () => number = Math.random): PresentedQuestion {
    const { family, q: pq } = this.prepared(type, q);
    return family.present(pq, rng);
  }

  /** true when the type never contributes points (polls, surveys...). */
  isScored(type: string): boolean {
    return this.getSpec(type).scored;
  }
}

export const registry = new QuestionTypeRegistry();

for (const f of baseFamilies) registry.registerFamily(f);
registry.registerFamily(
  makeCompositeFamily(
    (t, q, a) => registry.score(t, q, a),
    (t, q) => registry.validate(t, q),
    (t, q, rng) => registry.present(t, q, rng),
  ),
);

type Reg = [id: string, family: string, opts?: Partial<Omit<QuestionTypeSpec, 'id' | 'family'>>];

const TYPES: Reg[] = [
  // --- choice ---
  ['multiple_choice', 'single_choice'],
  ['true_false', 'single_choice', { defaults: { shuffleOptions: false } }],
  ['yes_no', 'single_choice', { defaults: { shuffleOptions: false } }],
  ['multiple_select', 'multi_choice', { defaults: { partialCredit: true } }],
  ['select_from_grid', 'multi_choice', { defaults: { partialCredit: true } }],
  ['odd_one_out', 'single_choice'],
  ['comparison', 'single_choice'],
  ['logic_puzzle', 'single_choice'],
  ['pattern_recognition', 'single_choice'],
  ['scenario_question', 'single_choice'],
  ['chart_question', 'single_choice', { media: 'image' }],
  ['graph_interpretation', 'single_choice', { media: 'image' }],
  ['color_question', 'single_choice'],
  ['randomized_options', 'single_choice', { defaults: { shuffleOptions: true } }],
  ['memory_question', 'multi_choice', { defaults: { partialCredit: true } }],
  // --- media choice ---
  ['image_choice', 'single_choice', { media: 'image' }],
  ['image_multiple_choice', 'multi_choice', { media: 'image', defaults: { partialCredit: true } }],
  ['audio_question', 'single_choice', { media: 'audio' }],
  ['video_question', 'single_choice', { media: 'video' }],
  // --- text ---
  ['fill_blank', 'text'],
  ['short_answer', 'text', { defaults: { matching: { typoTolerance: 1 } } }],
  ['identify_image', 'text', { media: 'image', defaults: { matching: { typoTolerance: 1 } } }],
  ['listen_and_answer', 'text', { media: 'audio' }],
  ['watch_and_answer', 'text', { media: 'video' }],
  ['word_scramble', 'text'],
  ['anagram', 'text'],
  ['hangman', 'text'],
  ['missing_letters', 'text'],
  ['spelling', 'text', { defaults: { matching: { typoTolerance: 0 } } }],
  ['sentence_completion', 'text'],
  ['code_question', 'text', { defaults: { matching: { caseSensitive: true } } }],
  ['formula_question', 'text'],
  // --- numeric ---
  ['numeric_answer', 'numeric'],
  ['calculation', 'numeric'],
  ['equation', 'numeric'],
  ['fraction', 'numeric'],
  ['percentage', 'numeric'],
  ['estimate', 'numeric', { defaults: { tolerancePercent: 0.1 } }],
  ['slider_answer', 'numeric', { defaults: { tolerance: 0 } }],
  ['scale_answer', 'numeric'],
  // --- ordering ---
  ['ordering', 'ordering', { defaults: { partialCredit: true } }],
  ['ranking', 'ordering', { defaults: { partialCredit: true } }],
  ['ranking_multiple_items', 'ordering', { defaults: { partialCredit: true } }],
  ['sequence', 'ordering', { defaults: { partialCredit: true } }],
  ['timeline', 'ordering', { defaults: { partialCredit: true } }],
  ['sentence_ordering', 'ordering', { defaults: { partialCredit: true } }],
  ['text_reconstruction', 'ordering', { defaults: { partialCredit: true } }],
  ['sequence_memory', 'ordering', { defaults: { partialCredit: false } }],
  // --- matching / categorization ---
  ['matching', 'matching', { defaults: { partialCredit: true } }],
  ['pairing', 'matching', { defaults: { partialCredit: true } }],
  ['categorization', 'categorization', { defaults: { partialCredit: true } }],
  ['drag_drop', 'categorization', { defaults: { partialCredit: true } }],
  // --- spatial ---
  ['image_hotspot', 'hotspot', { media: 'image' }],
  ['map_question', 'hotspot', { media: 'image' }],
  ['coordinate_question', 'hotspot'],
  // --- grid puzzles ---
  ['crossword', 'grid', { defaults: { partialCredit: true } }],
  ['word_search', 'grid', { defaults: { partialCredit: true } }],
  ['matrix_grid', 'grid', { defaults: { partialCredit: true } }],
  ['table_question', 'grid', { defaults: { partialCredit: true } }],
  // --- special scoring ---
  ['confidence_based', 'confidence'],
  ['flashcard', 'flashcard'],
  // --- unscored collection ---
  ['poll', 'unscored', { scored: false }],
  ['survey', 'unscored', { scored: false }],
  ['personality_question', 'unscored', { scored: false }],
  ['ranking_poll', 'unscored', { scored: false }],
  // --- free submission (manual review unless keywords/accepted provided) ---
  ['long_answer', 'submission', { manualReview: true }],
  ['open_text', 'submission', { manualReview: true }],
  ['voice_answer', 'submission', { manualReview: true, media: 'audio' }],
  ['speaking_question', 'submission', { manualReview: true, media: 'audio' }],
  ['handwriting_drawing', 'submission', { manualReview: true, media: 'image' }],
  // --- composite / structured ---
  ['multi_part', 'composite'],
  ['compound_question', 'composite'],
  ['branching_question', 'composite'],
  ['progressive_question', 'composite'],
  ['adaptive_question', 'composite'],
  ['reading_comprehension', 'composite'],
  ['passage_based', 'composite'],
  ['case_study', 'composite'],
  ['text_plus_question', 'composite'],
  ['random_question', 'composite'],
];

for (const [id, family, opts] of TYPES) {
  registry.register({
    id,
    family,
    scored: opts?.scored ?? true,
    manualReview: opts?.manualReview ?? false,
    defaults: opts?.defaults,
    media: opts?.media ?? 'none',
  });
}
