# Changelog

All notable changes to QUIZ PLATFORM. Format: [Keep a Changelog](https://keepachangelog.com/), versions follow [SemVer](https://semver.org/).

## [Unreleased]

Skill-checklist pass (web security, performance, PWA, SEO, accessibility, design) — every finding verified against the running app.

### Security
- API responses: `cache-control: no-store` by default and a locked-down CSP (`default-src 'none'`); `object-src 'none'` on the shell; CORS no longer advertises credentials (no cookies exist).
- Blocked `localStorage` (private mode, strict webviews) can no longer break boot: all reads/writes go through guarded helpers.

### Performance & PWA
- Hashed bundles are served `immutable` for a year; `index.html`, `sw.js` and the manifest always revalidate.
- Quiz screens are a lazy chunk (main bundle 104 kB → 72 kB); web font requested at parse time instead of after `load`.
- Service worker keeps itself alive until cache writes land; manifest gains a stable `id` and a maskable 192 px icon.

### SEO
- Unknown paths return a real 404 status; per-route `<title>`, canonical URL and `robots` meta (private routes `noindex`).
- `<html lang="ar" dir="rtl">` default, absolute `og:image`, sitemap lists public pages only (+`lastmod`), robots disallows private routes.
- One locale detector: Arabic-language browsers start in Arabic on first visit.

### Accessibility (axe: 0 violations on 62 scans, 17 routes × AR/EN × phone/desktop)
- Light theme tokens darkened to WCAG AA (text 5.1:1, accents ≥4.6:1, input borders 3:1); locked achievements no longer fade their text.
- Choice questions follow the ARIA radiogroup pattern (roving tabindex, arrow keys); Enter on a focused option selects it instead of submitting a different one.
- Every answer control (range, text, selects, grid, textarea) and the quiz setup form has an accessible name; login has `autocomplete`.
- Question prompt is the page `<h1>`, feedback is a live `status` region, timer no longer announces every second, keyboard hint visible to assistive tech.
- Footer is a real `contentinfo` landmark, `<main>` is focusable for the skip link, nav landmarks named, tables have `scope="col"`, heading order fixed.
- 44 px touch targets on coarse pointers; phone top-nav overflow gets a fade affordance.

### Design (v4 "ember & ink")
- New visual system: cool navy ink on soft paper (light) and deep-night navy (dark), one ember accent for every action, Cairo variable font for Arabic and Latin.
- Floating pill navigation on desktop (edge bar on phones), double-bezel quiz card, colour-coded accent bars on answer tiles, squircle avatars, staggered card entry.
- Sentence-case labels, heavier display headings, dedicated blue focus ring distinct from selection; all token pairs verified ≥4.5:1 (text) and ≥3:1 (borders) in both themes.
- Skeleton loaders replace spinners for every data view; `100dvh`; z-index scale tokens.

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

### Launch gates
- `docs/GATES.md`: evidence for every gate of the 46-section launch checklist (counts, commands, remaining owner-only items).
- Migration checksums: a migration file edited after being applied aborts boot with a clear message.
- Privacy data export (`GET /users/me/export`, "Download my data" on the profile) with audit trail.
- Help & support page (`/help`): FAQ, support mail, bug reports, system status link.
- Optional GPG-encrypted backups (`BACKUP_GPG_RECIPIENT`); restore verifies checksum and decrypts.
- ESLint (typescript-eslint + react-hooks) in `npm run lint` and CI; E2E smoke skips non-choice questions instead of flaking.

### AI gateway (SOURCE_LOCK)
- `modules/ai`: provider abstraction (Anthropic SDK with structured output, or `mock`), disabled by default.
- Drafts are validated by the engine, de-duplicated and filed as `pending_review`; religious categories are refused before any provider call; per-user and platform daily quotas with a token ledger.

### Tests
- 28 new tests (119 total): ownership, lockout, session invalidation, rate limiting over HTTP, readiness, job locking, archive-on-delete, cache sizing, CSV hardening, AI gateway, migration checksums, data export.

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
