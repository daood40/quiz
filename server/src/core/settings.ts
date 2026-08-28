import { query } from '../db/pool.js';

/**
 * Global settings — stored in app_settings, cached in-process with a short TTL.
 * Nothing gameplay-critical is hardcoded: points, XP, limits are all tunable.
 */
export interface AppSettings {
  defaultQuestionTimeSec: number;
  defaultQuizSize: number;
  pointsPerDifficulty: Record<string, number>;
  speedBonusEnabled: boolean;
  speedBonusMaxPercent: number;   // extra % of base points for instant answers
  xpPerCorrect: number;
  xpQuizCompletion: number;
  xpDailyChallenge: number;
  xpMonthlyChallenge: number;
  xpTournamentWin: number;
  xpPerLevel: number;             // base for level curve
  dailyQuizLimit: number;         // 0 = unlimited
  leaderboardSize: number;
  leaderboardCacheTtlSec: number;
  guestModeEnabled: boolean;
  guestMaxQuestions: number;
  registrationEnabled: boolean;
  maintenanceMode: boolean;
  challengeMaxQuestions: number;
  challengeDefaultExpiryHours: number;
  tournamentDefaultQuestions: number;
  antiCheatMinAnswerMs: number;   // answers faster than this are flagged
  antiCheatGraceMs: number;       // allowed clock slack past deadline
  streakMilestones: number[];
  streakFreezeCap: number;        // max banked streak freezes
  powerupFiftyFifty: number;      // 50/50 uses granted per timed quiz
  powerupTimeExtend: number;      // time-extension uses granted per timed quiz
  timeExtendSec: number;          // seconds added by a time extension
}

export const DEFAULT_SETTINGS: AppSettings = {
  defaultQuestionTimeSec: 30,
  defaultQuizSize: 10,
  pointsPerDifficulty: { easy: 10, medium: 15, hard: 20, expert: 30 },
  speedBonusEnabled: true,
  speedBonusMaxPercent: 50,
  xpPerCorrect: 5,
  xpQuizCompletion: 20,
  xpDailyChallenge: 50,
  xpMonthlyChallenge: 100,
  xpTournamentWin: 200,
  xpPerLevel: 250,
  dailyQuizLimit: 0,
  leaderboardSize: 100,
  leaderboardCacheTtlSec: 60,
  guestModeEnabled: true,
  guestMaxQuestions: 10,
  registrationEnabled: true,
  maintenanceMode: false,
  challengeMaxQuestions: 50,
  challengeDefaultExpiryHours: 72,
  tournamentDefaultQuestions: 10,
  antiCheatMinAnswerMs: 350,
  antiCheatGraceMs: 3000,
  streakMilestones: [1, 3, 7, 14, 30, 100, 365],
  streakFreezeCap: 3,
  powerupFiftyFifty: 2,
  powerupTimeExtend: 1,
  timeExtendSec: 20,
};

let cache: { value: AppSettings; at: number } | null = null;
const CACHE_TTL_MS = 15_000;

export async function getSettings(): Promise<AppSettings> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  const { rows } = await query<{ key: string; value: unknown }>('SELECT key, value FROM app_settings');
  const merged: AppSettings = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key in merged) (merged as unknown as Record<string, unknown>)[row.key] = row.value;
  }
  cache = { value: merged, at: Date.now() };
  return merged;
}

export async function updateSettings(patch: Partial<AppSettings>, updatedBy: string | null): Promise<AppSettings> {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    await query(
      `INSERT INTO app_settings (key, value, updated_by) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = now()`,
      [key, JSON.stringify(value), updatedBy],
    );
  }
  cache = null;
  return getSettings();
}

export function invalidateSettingsCache(): void {
  cache = null;
}
