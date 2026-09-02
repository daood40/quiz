import type { AppSettings } from '../../core/settings.js';
import type { ScoreResult } from '../questions/engine/types.js';

export interface PointsInput {
  basePoints: number;          // question.points (0 → difficulty default)
  difficulty: string;
  result: ScoreResult;
  timeTakenMs: number;
  timeLimitMs: number;
  scored: boolean;             // registry spec.scored
  streakBefore?: number;       // consecutive correct answers earlier in this round
  speedMultiplier?: number;    // 0 = no speed bonus, 2 = speed mode
  statsAttempts?: number;      // lifetime recorded answers for this question
}

export interface PointsOutput {
  points: number;
  maxPoints: number;
  speedBonus: number;
  streakBonus: number;
}

/**
 * Universal points computation.
 * correct → base * ratio (+ optional speed bonus); wrong/timeout/skip → 0.
 * All coefficients come from settings — nothing hardcoded.
 */
export function computePoints(input: PointsInput, settings: AppSettings): PointsOutput {
  if (!input.scored) return { points: 0, maxPoints: 0, speedBonus: 0, streakBonus: 0 };
  let base =
    input.basePoints > 0
      ? input.basePoints
      : settings.pointsPerDifficulty[input.difficulty] ?? settings.pointsPerDifficulty.medium ?? 10;
  // Anti-inflation: while a question's difficulty is statistically unstable
  // (few recorded answers), difficulty-based pay is damped to the medium rate.
  if (
    input.basePoints <= 0 &&
    settings.newQuestionStabilityThreshold > 0 &&
    (input.statsAttempts ?? Number.MAX_SAFE_INTEGER) < settings.newQuestionStabilityThreshold
  ) {
    base = settings.pointsPerDifficulty.medium ?? base;
  }
  const maxPoints = base;
  const { outcome, ratio } = input.result;
  if (outcome === 'timeout' || outcome === 'skipped' || outcome === 'incorrect') {
    return { points: 0, maxPoints, speedBonus: 0, streakBonus: 0 };
  }
  let points = base * ratio;
  let speedBonus = 0;
  if (settings.speedBonusEnabled && outcome === 'correct' && input.timeLimitMs > 0) {
    const remaining = Math.max(0, 1 - input.timeTakenMs / input.timeLimitMs);
    speedBonus = Math.round((input.speedMultiplier ?? 1) * base * (settings.speedBonusMaxPercent / 100) * remaining);
    points += speedBonus;
  }
  let streakBonus = 0;
  if (settings.streakBonusEnabled && outcome === 'correct') {
    streakBonus = Math.min((input.streakBefore ?? 0) + 1, settings.streakBonusCap) * settings.streakBonusPerStep;
    points += streakBonus;
  }
  return { points: Math.round(points), maxPoints, speedBonus, streakBonus };
}
