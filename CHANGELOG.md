# Changelog

All notable changes to QUIZ PLATFORM. Format: [Keep a Changelog](https://keepachangelog.com/), versions follow [SemVer](https://semver.org/).

## [1.1.0] - 2026-09-04

Master Directive hardening release: audited end-to-end (security, data layer, operations, frontend) and fixed in place. See `docs/MASTER_PLAN.md`.

### Security
- `JWT_SECRET` mandatory outside tests (random per boot in development); explicit `TRUST_PROXY` hop count for rate limiting.
- Reset/verification tokens never returned outside the test suite; public profiles no longer expose email.
- Ownership checks on challenge summaries, private groups and group leaderboards; UUID validation on path params; settings value validation.
- Login lockout (10 failures / 15 min) with `auth.login_failed` audit; immediate session invalidation on ban, role change, password reset (`sessions_valid_after`).
- CSP + Permissions-Policy on the SPA shell, `x-request-id` on every response, log redaction, CSV import cap + formula-injection guard.
- Admin audit rows carry actor IP and previous values; retention job for guests, analytics and audit logs.

### Data & operations
- Migration 004: 17 FK indexes, `updated_at` + trigger on 15 tables, `job_runs`, `groups.deleted_at`.
- Answered questions are archived instead of hard-deleted; leaderboard snapshot cache no longer shrinks for small requests.
- Advisory locks for migrations and background jobs (safe with many instances), overlap guard, job telemetry on `/ready`.
- `/ready` readiness probe (DB latency, pool, failing jobs), Prometheus `/metrics`, error webhook + optional Sentry.
- Set-based transactional point refunds; transactional batched imports; bounded/cached list endpoints.
- `scripts/backup.sh` / `scripts/restore.sh`, compose backup sidecar, CI restore drill.

### Web
- Every data view has loading / empty / error states with retry; question registry failures no longer degrade silently.
- Admin console fully translated (AR/EN) with pagination, debounced search and an AI drafts tab.
- Route-level code splitting (admin/social), double-submit guards on every mutation, labelled fields, accessible icon buttons, keyboard-operable hotspot.
- Password strength meter, confirm + show/hide, translated network errors, report-a-question dialog with reasons.
- Offline banner app-wide, countdown pauses offline, service worker never caches error pages, versioned shell with update prompt.

### Launch readiness
- Transactional mail adapter (`MAIL_PROVIDER=resend` or `log`): password-reset and verification emails with deep links (`/forgot?token=`, `/verify?token=`), resend-verification endpoint and banner.
- Religion category ships hidden with its questions in review until a specialist reviewer enables it (directive §10).
- Error webhook payload compatible with Discord, Slack and Telegram relays; `TRUST_PROXY=1` preset for Render/Fly.
- `docs/LAUNCH.md`: step-by-step Arabic launch guide (Render blueprint, Pages switch, domain, mail, alerts, content, pre-launch checklist).

### AI gateway (SOURCE_LOCK)
- `modules/ai`: provider abstraction (Anthropic SDK with structured output, or `mock`), disabled by default.
- Drafts are validated by the engine, de-duplicated and filed as `pending_review`; religious categories are refused before any provider call; per-user and platform daily quotas with a token ledger.

### Tests
- 24 new tests (115 total): ownership, lockout, session invalidation, rate limiting over HTTP, readiness, job locking, archive-on-delete, cache sizing, CSV hardening, AI gateway.

## [1.0.0] - 2026-09-03

First production release.

### Platform
- Server-authoritative quiz engine: 80 question types on 13 interaction families, partial credit, server-side timing, anti-cheat.
- Modes: practice, timed, speed, survival, knowledge, review, bookmarks, daily.
- Fair competitive scoring: speed bonus, in-round streak bonus, new-question damping, daily competitive cap, practice isolated from rankings.
- Leaderboards (global, monthly, friends, groups), shareable challenges, monthly challenges, knockout tournaments.
- XP, levels, streaks, achievements; ask-the-audience, 50/50, skip power-ups.
- Question versions with review on edit, season point refunds for wrong answer keys, religion-category source rule.
- Admin panel: review queue, CSV/JSON import/export, users and roles, live platform settings.

### Web
- React 18 SPA, Arabic/English (RTL/LTR), light/dark, installable PWA with offline shell.
- Kahoot-style tiles, category wheel, haptics, confetti, large-text and auto-advance settings, result image sharing.
- Privacy, terms, 404, skip-link, SEO metadata, robots and sitemap.
- Static demo (in-browser engine + 154-question bank) at https://daood40.github.io/quiz/.

### Ops
- `Dockerfile` (API + SPA in one image), `docker-compose.yml`, Render blueprint, Fly config, GHCR image on every push and tag.
- `SEED_ON_BOOT=true` creates the admin, categories and starter bank on first start.
- CI: typecheck, 91 tests on PostgreSQL 16, build, dependency audit, Playwright smoke E2E, image smoke run.
