import type { AppSettings } from '../../core/settings.js';
import type { ScoreResult } from '../questions/engine/types.js';

export interface PointsInput {
  basePoints: number;          // question.points (0 → difficulty default)
  difficulty: string;
  result: ScoreResult;
  timeTakenMs: number;
  timeLimitMs: number;
  scored: boolean;             // registry spec.scored
}

export interface PointsOutput {
  points: number;
  maxPoints: number;
  speedBonus: number;
}

/**
 * Universal points computation.
 * correct → base * ratio (+ optional speed bonus); wrong/timeout/skip → 0.
 * All coefficients come from settings — nothing hardcoded.
 */
export function computePoints(input: PointsInput, settings: AppSettings): PointsOutput {
  if (!input.scored) return { points: 0, maxPoints: 0, speedBonus: 0 };
  const base =
    input.basePoints > 0
      ? input.basePoints
      : settings.pointsPerDifficulty[input.difficulty] ?? settings.pointsPerDifficulty.medium ?? 10;
  const maxPoints = base;
  const { outcome, ratio } = input.result;
  if (outcome === 'timeout' || outcome === 'skipped' || outcome === 'incorrect') {
    return { points: 0, maxPoints, speedBonus: 0 };
  }
  let points = base * ratio;
  let speedBonus = 0;
  if (settings.speedBonusEnabled && outcome === 'correct' && input.timeLimitMs > 0) {
    const remaining = Math.max(0, 1 - input.timeTakenMs / input.timeLimitMs);
    speedBonus = Math.round(base * (settings.speedBonusMaxPercent / 100) * remaining);
    points += speedBonus;
  }
  return { points: Math.round(points), maxPoints, speedBonus };
}
