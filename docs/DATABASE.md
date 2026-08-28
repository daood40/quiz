# Database

PostgreSQL 16. Extensions: `citext` (case-insensitive emails), `pg_trgm`
(near-duplicate detection + fuzzy search). Migrations are plain SQL files in
`server/src/db/migrations/`, applied in filename order, each in its own
transaction, tracked in `schema_migrations`. They run via `npm run migrate`
and automatically on server boot.

## Table groups

**Identity & auth** — `users` (role, status, guest flag, language, timezone,
XP/level/points/streak denormalized for hot paths), `refresh_tokens` /
`password_reset_tokens` / `email_verification_tokens` (SHA-256 hashes only).

**Taxonomy** — `categories` (self-referencing tree, JSONB `{ar,en}` names,
sort order, active flag).

**Questions** — `questions` (universal model: `type`, `content` JSONB,
`correct_answer` JSONB *never exposed via public APIs*, `configuration`,
points, time limit, explanation, tags[], source/verification fields, review
`status`, `quality_score`, `content_hash` for exact-duplicate detection),
`question_stats` (live counters), `question_reports`.

**Play** — `quizzes` (admin-defined/scheduled), `attempts` (server-selected
`question_ids`, timing metadata, deadline, totals, anti-cheat `flags` +
`suspicion`), `attempt_answers` (**UNIQUE(attempt_id, question_id)** =
duplicate-submission protection), `suspicious_events`.

**Competition** — `challenges` + `challenge_participants`,
`monthly_challenges` (UNIQUE `year_month`), `tournaments` →
`tournament_rounds` → `tournament_matches` (+`tournament_participants`),
`groups` + `group_members`, `friendships`.

**Gamification** — `achievements` (JSONB criteria `{metric, gte}`),
`user_achievements`, `xp_events`, `user_stats` (aggregates + per-category
JSONB), `daily_activity` (PK user+day).

**Ranking** — `leaderboard_scores` (UNIQUE(user, scope, scope_key)) with the
composite rank index `(scope, scope_key, points DESC, total_time_ms ASC,
correct DESC, last_scored_at ASC)`; `leaderboard_snapshots` cache.

**Ops** — `app_settings` (runtime-tunable), `audit_logs`,
`analytics_events`, `notifications`.

## Integrity & concurrency

- FKs with deliberate `ON DELETE` behavior everywhere; CHECK constraints on
  enums, ranges, and self-references.
- Partial unique index: one live attempt per user per competitive context.
- All multi-step writes (registration, answers, submission, tournament
  resolution) run in transactions; attempt rows are locked `FOR UPDATE`
  during answer/submit to serialize concurrent requests.

## Scaling plan (120k → 1M → 10M+ questions)

Nothing binds the design to a count. The pool query is driven by the
composite index `(status, category_id, difficulty, language, type)` + GIN on
tags. At larger scales, in order: (1) replace `ORDER BY random()` with
random-key-range sampling, (2) partition `attempt_answers` and
`analytics_events` by month, (3) move leaderboard reads fully onto
snapshots refreshed by workers, (4) read replicas for stats/analytics,
(5) table-partition `questions` by language/category if ever needed.

## Backups & recovery

- **Backups:** nightly `pg_dump -Fc` + WAL archiving for PITR
  (`archive_mode=on`); retain 7 daily / 4 weekly / 12 monthly.
- **Recovery:** restore latest base backup, replay WAL to target time,
  verify `schema_migrations` matches the deployed code, then re-point the
  API.
- **Migration rollback:** migrations are forward-only; a bad migration is
  reverted by a new corrective migration (or PITR when data was damaged).
  Deploy order: migrate → boot new code (migrations are additive within a
  release).
