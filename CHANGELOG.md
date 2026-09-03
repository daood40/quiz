# Changelog

All notable changes to QUIZ PLATFORM. Format: [Keep a Changelog](https://keepachangelog.com/), versions follow [SemVer](https://semver.org/).

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
