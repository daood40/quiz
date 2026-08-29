import { describe, expect, it } from 'vitest';
import { computePoints } from '../src/modules/scoring/points.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import { levelFromXp, xpForNextLevel, localDate } from '../src/modules/gamification/service.js';
import { getIsoWeekKey } from '../src/modules/quizzes/attempts.js';
import { parseCsv, toCsv } from '../src/modules/admin/importExport.js';
import { _testConsume, _testReset } from '../src/core/rateLimit.js';
import { computeContentHash } from '../src/modules/questions/service.js';

const settings = { ...DEFAULT_SETTINGS, streakBonusEnabled: false };  // bonuses isolated per test
const streaky = { ...DEFAULT_SETTINGS, speedBonusEnabled: false };

describe('points engine', () => {
  it('correct answer earns base + speed bonus', () => {
    const r = computePoints(
      { basePoints: 10, difficulty: 'easy', result: { outcome: 'correct', ratio: 1 }, timeTakenMs: 0, timeLimitMs: 30000, scored: true },
      settings,
    );
    expect(r.points).toBe(15); // 10 + 50% max speed bonus
    expect(r.speedBonus).toBe(5);
  });
  it('slow correct answer earns no bonus', () => {
    const r = computePoints(
      { basePoints: 10, difficulty: 'easy', result: { outcome: 'correct', ratio: 1 }, timeTakenMs: 30000, timeLimitMs: 30000, scored: true },
      settings,
    );
    expect(r.points).toBe(10);
  });
  it('wrong/timeout/skipped earn 0', () => {
    for (const outcome of ['incorrect', 'timeout', 'skipped'] as const) {
      const r = computePoints(
        { basePoints: 10, difficulty: 'easy', result: { outcome, ratio: 0 }, timeTakenMs: 100, timeLimitMs: 30000, scored: true },
        settings,
      );
      expect(r.points).toBe(0);
    }
  });
  it('partial credit scales points, no speed bonus', () => {
    const r = computePoints(
      { basePoints: 20, difficulty: 'medium', result: { outcome: 'partial', ratio: 0.75 }, timeTakenMs: 0, timeLimitMs: 30000, scored: true },
      settings,
    );
    expect(r.points).toBe(15);
  });
  it('difficulty defaults apply when basePoints=0', () => {
    const r = computePoints(
      { basePoints: 0, difficulty: 'expert', result: { outcome: 'correct', ratio: 1 }, timeTakenMs: 30000, timeLimitMs: 30000, scored: true },
      settings,
    );
    expect(r.points).toBe(settings.pointsPerDifficulty.expert);
  });
  it('unscored types earn nothing', () => {
    const r = computePoints(
      { basePoints: 10, difficulty: 'easy', result: { outcome: 'correct', ratio: 1 }, timeTakenMs: 0, timeLimitMs: 30000, scored: false },
      settings,
    );
    expect(r.points).toBe(0);
    expect(r.maxPoints).toBe(0);
  });
  it('speed bonus can be disabled via settings', () => {
    const r = computePoints(
      { basePoints: 10, difficulty: 'easy', result: { outcome: 'correct', ratio: 1 }, timeTakenMs: 0, timeLimitMs: 30000, scored: true },
      { ...settings, speedBonusEnabled: false },
    );
    expect(r.points).toBe(10);
  });
  it('in-round streak bonus grows per consecutive correct and caps', () => {
    const base = { basePoints: 10, difficulty: 'easy', result: { outcome: 'correct', ratio: 1 } as const, timeTakenMs: 30000, timeLimitMs: 30000, scored: true };
    expect(computePoints({ ...base, streakBefore: 0 }, streaky).streakBonus).toBe(2);   // 1st correct
    expect(computePoints({ ...base, streakBefore: 4 }, streaky).streakBonus).toBe(10);  // 5th correct
    expect(computePoints({ ...base, streakBefore: 9 }, streaky).streakBonus).toBe(10);  // capped at 5 steps
    expect(computePoints({ ...base, streakBefore: 4 }, streaky).points).toBe(20);       // 10 base + 10 streak
  });
  it('streak bonus never applies to non-correct outcomes', () => {
    const r = computePoints(
      { basePoints: 10, difficulty: 'easy', result: { outcome: 'partial', ratio: 0.5 }, timeTakenMs: 30000, timeLimitMs: 30000, scored: true, streakBefore: 4 },
      streaky,
    );
    expect(r.streakBonus).toBe(0);
  });
  it('unstable questions (below stability threshold) pay the medium rate', () => {
    const base = { difficulty: 'expert', result: { outcome: 'correct', ratio: 1 } as const, timeTakenMs: 30000, timeLimitMs: 30000, scored: true };
    // difficulty-priced + few recorded answers → damped to medium
    expect(computePoints({ ...base, basePoints: 0, statsAttempts: 10 }, settings).points).toBe(settings.pointsPerDifficulty.medium);
    // enough answers → full expert rate
    expect(computePoints({ ...base, basePoints: 0, statsAttempts: 500 }, settings).points).toBe(settings.pointsPerDifficulty.expert);
    // author-set explicit points are always respected
    expect(computePoints({ ...base, basePoints: 40, statsAttempts: 10 }, settings).points).toBe(40);
    // damping disabled via settings
    expect(
      computePoints({ ...base, basePoints: 0, statsAttempts: 10 }, { ...settings, newQuestionStabilityThreshold: 0 }).points,
    ).toBe(settings.pointsPerDifficulty.expert);
  });
});

describe('level curve', () => {
  it('levels follow triangular XP curve', () => {
    expect(levelFromXp(0, 250)).toBe(1);
    expect(levelFromXp(249, 250)).toBe(1);
    expect(levelFromXp(250, 250)).toBe(2);
    expect(levelFromXp(750, 250)).toBe(3);
    expect(xpForNextLevel(1, 250)).toBe(250);
    expect(xpForNextLevel(2, 250)).toBe(750);
  });
});

describe('timezone dates', () => {
  it('computes local date across timezones', () => {
    const at = new Date('2026-08-28T23:30:00Z');
    expect(localDate('UTC', at)).toBe('2026-08-28');
    expect(localDate('Asia/Riyadh', at)).toBe('2026-08-29'); // UTC+3
    expect(localDate('not-a-tz', at)).toBe('2026-08-28'); // falls back to UTC
  });
  it('iso week keys', () => {
    expect(getIsoWeekKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-W01');
    expect(getIsoWeekKey(new Date('2026-08-28T00:00:00Z'))).toBe('2026-W35');
  });
});

describe('CSV parser', () => {
  it('handles quotes, commas, newlines', () => {
    const rows = parseCsv('a,b,c\r\n"x,y","he said ""hi""","line1\nline2"');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x,y', 'he said "hi"', 'line1\nline2'],
    ]);
  });
  it('roundtrips through toCsv', () => {
    const data = [['col1', 'col2'], ['قيمة عربية', 'with,comma']];
    const parsed = parseCsv(toCsv(data));
    expect(parsed).toEqual(data);
  });
});

describe('rate limiter', () => {
  it('enforces max per window', () => {
    _testReset();
    const now = Date.now();
    for (let i = 0; i < 5; i++) expect(_testConsume('k', 5, 1000, now)).toBe(true);
    expect(_testConsume('k', 5, 1000, now)).toBe(false);
    // window reset
    expect(_testConsume('k', 5, 1000, now + 2000)).toBe(true);
  });
});

describe('duplicate detection hash', () => {
  it('is stable across formatting/diacritics', () => {
    const h1 = computeContentHash('multiple_choice', { prompt: { en: 'What is  the Capital of France?' } }, 'o1');
    const h2 = computeContentHash('multiple_choice', { prompt: { en: 'what is the capital of france' } }, 'o1');
    expect(h1).toBe(h2);
    const h3 = computeContentHash('multiple_choice', { prompt: { en: 'what is the capital of spain' } }, 'o1');
    expect(h1).not.toBe(h3);
  });
});
