/**
 * Universal Question Engine — core contracts.
 *
 * Every question type registered in the QuestionTypeRegistry maps to a
 * scoring/validation "family" (an interaction primitive). Adding a new type
 * means registering an id + family + default config — no engine rewrite.
 */

export type Outcome = 'correct' | 'incorrect' | 'partial' | 'timeout' | 'skipped';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

/** Result of scoring a single answer. ratio is credit in [0,1]. */
export interface ScoreResult {
  outcome: Outcome;
  ratio: number;
  /** Optional detail for review screens (per-item correctness etc.) */
  detail?: unknown;
}

/** The server-side view of a question handed to the engine. */
export interface EngineQuestion {
  type: string;
  content: Record<string, unknown>;
  correctAnswer: unknown;
  configuration: Record<string, unknown>;
}

export interface QuestionFamily {
  id: string;
  /** Returns a list of human-readable validation errors (empty = valid). */
  validate(q: EngineQuestion): string[];
  /** Scores a submitted answer. Must never throw on malformed answers. */
  score(q: EngineQuestion, answer: unknown): ScoreResult;
  /**
   * Returns the content safe to send to clients (correct answers stripped,
   * options optionally shuffled with the shuffle map returned separately).
   */
  present(q: EngineQuestion, rng: () => number): PresentedQuestion;
}

export interface PresentedQuestion {
  content: Record<string, unknown>;
  /** Server-kept metadata needed to interpret the client's answer (e.g. shuffle map). */
  serverMeta: Record<string, unknown>;
}

export interface QuestionTypeSpec {
  id: string;
  family: string;
  /** false → collected but never scored (polls, surveys, personality). */
  scored: boolean;
  /** true → answer stored for human review (essays, voice, drawing). */
  manualReview: boolean;
  /** Extra defaults merged into question configuration at scoring time. */
  defaults?: Record<string, unknown>;
  /** Media kind hint for clients. */
  media?: 'image' | 'audio' | 'video' | 'none';
}

export const OUTCOMES: Outcome[] = ['correct', 'incorrect', 'partial', 'timeout', 'skipped'];

export function clampRatio(r: number): number {
  if (!Number.isFinite(r)) return 0;
  return Math.max(0, Math.min(1, r));
}

/** Standard result helper honoring partial-credit configuration. */
export function ratioToResult(ratio: number, partialCredit: boolean, detail?: unknown): ScoreResult {
  const r = clampRatio(ratio);
  if (r >= 1) return { outcome: 'correct', ratio: 1, detail };
  if (r <= 0) return { outcome: 'incorrect', ratio: 0, detail };
  if (!partialCredit) return { outcome: 'incorrect', ratio: 0, detail };
  return { outcome: 'partial', ratio: r, detail };
}
