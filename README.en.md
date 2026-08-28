# 🧠 QUIZ PLATFORM

**🌐 Live demo:** <https://daood40.github.io/quiz/> — the `Deploy demo to GitHub Pages` workflow publishes a fully in-browser demo (real question engine + bundled bank, progress in localStorage) on every push to the default branch. Competitions, friends and admin need the full server below. Arabic overview: [README.md](README.md).

A production-grade, bilingual (Arabic/English) quiz & competition platform:
a **Universal Question Engine** (80 question types), server-authoritative
scoring and anti-cheat, leaderboards, challenges, monthly challenges,
tournaments, groups, gamification (XP / levels / streaks / achievements),
notifications, statistics, and a full admin panel.

| Layer | Stack |
|---|---|
| Backend | Node.js 20+, Fastify 5, TypeScript (ESM) |
| Database | PostgreSQL 16 (`citext`, `pg_trgm`) |
| Frontend | React 18 + Vite, custom design system, RTL/LTR |
| Auth | JWT access + rotating opaque refresh tokens, RBAC (5 roles) |
| Tests | Vitest — unit + integration on a real PostgreSQL database |

> **Why not Flutter + Supabase?** The master directive prefers them but allows a
> better-suited stack with justification — see
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#stack-decision).

## Overview

- **Universal Question Engine** — a `QuestionTypeRegistry` maps 80 question
  type ids onto 13 scoring/validation *families* (interaction primitives).
  Every type has real validation, scoring (with optional partial credit),
  answer parsing, and sanitized presentation. Adding a type = one
  registration line + (optionally) a client renderer.
- **Server-authoritative play** — the client never sends a score. The server
  selects questions, stores correct answers privately, timestamps every
  answer, enforces per-question and overall deadlines, blocks duplicate and
  replayed submissions, and flags suspicious activity for human review.
- **Competition engines** — ranked leaderboards (points → total time →
  correct → completion timestamp), shareable challenges with identical
  question sets, auto-created monthly challenges, and single-elimination
  tournaments (rounds → matches → attempts → results).

## Repository layout

```
server/            Fastify API (src/modules/* per domain), SQL migrations, seeds, tests
web/               React SPA (pages, per-family question renderers, i18n, themes)
docs/              Architecture, database, API, security, testing, deployment, roadmap
.env.example       Environment template (no real secrets)
```

## Prerequisites

- Node.js ≥ 20 and npm ≥ 10
- PostgreSQL ≥ 16 with the `citext` and `pg_trgm` extensions available

## Installation

```bash
git clone <repo> quiz-platform && cd quiz-platform
npm install                       # installs server + web workspaces

# create databases (as a postgres superuser)
createuser quiz -P                # choose a password
createdb quiz_platform -O quiz
createdb quiz_platform_test -O quiz
psql -d quiz_platform  -c 'CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS pg_trgm;'
psql -d quiz_platform_test -c 'CREATE EXTENSION IF NOT EXISTS citext; CREATE EXTENSION IF NOT EXISTS pg_trgm;'

cp .env.example .env              # then fill in DATABASE_URL, JWT_SECRET, ...
```

## Environment

All configuration is environment-driven — see [.env.example](.env.example).
`JWT_SECRET` is **required** in production (≥ 32 chars; generate with
`openssl rand -hex 64`). Nothing gameplay-critical is hardcoded: points, XP,
limits and toggles live in the `app_settings` table, editable from the admin
panel at runtime.

## Database: migrations & seed

```bash
npm run migrate            # applies server/src/db/migrations/*.sql in order
SEED_ADMIN_PASSWORD='ChangeMe123!' npm run seed
```

The seed has two layers:
- **Core (idempotent, production-safe):** categories, achievements, and a
  `super_admin` account (`admin` / `SEED_ADMIN_EMAIL`, default
  `admin@quiz.local`). Change the password after first login.
- **Dev samples** (skipped when `NODE_ENV=production` unless `SEED_DEV=true`):
  a starter bank of 115+ real questions covering every question family, AR+EN.

## Running

```bash
npm run dev                # API on :3001 (tsx watch) + web on :5173 (vite, proxies /api)
# or individually:
npm run dev --workspace=server
npm run dev --workspace=web
```

Production build (single server serves API + SPA):

```bash
npm run build              # tsc build (server) + vite build (web)
NODE_ENV=production node server/dist/index.js
```

The server runs pending migrations on boot, then serves `/api/v1/*` and the
built SPA (with an SPA fallback for client routes).

## Testing

```bash
npm test                   # 73 tests: engine unit tests + API integration tests
```

Integration tests run against `DATABASE_URL_TEST` on a real PostgreSQL — no
mocked database. See [docs/TESTING.md](docs/TESTING.md).

## Admin

Log in with the seeded super admin → the **Admin** tab appears:
dashboard KPIs, question review workflow (draft → pending → approved /
rejected / archived; only approved questions are served to players), bulk
actions, CSV/JSON import with row-level validation errors, export, duplicate
detection, user management (roles, suspend/ban), question reports,
anti-cheat review queue, and live platform settings.

## Documentation

| Doc | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layers, module map, question engine design, stack decision |
| [docs/DATABASE.md](docs/DATABASE.md) | Schema, indexes, scaling plan, backups |
| [docs/API.md](docs/API.md) | REST endpoints under `/api/v1` |
| [docs/SECURITY.md](docs/SECURITY.md) | Auth, RBAC, anti-cheat, rate limiting, error policy |
| [docs/TESTING.md](docs/TESTING.md) | Test strategy and how to run suites |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production deployment, scaling, backups, rollback |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Delivered phases and future work |

## Troubleshooting

- **`Missing required env var: DATABASE_URL`** — copy `.env.example` to `.env`.
- **`extension "citext" is not available`** — install `postgresql-contrib`.
- **401 loops in the web app** — the refresh token expired; log in again.
- **`No questions available`** — no *approved* questions match the filter;
  approve questions in Admin → Questions or run the seed.
- **Port already in use** — set `PORT` in `.env`.
