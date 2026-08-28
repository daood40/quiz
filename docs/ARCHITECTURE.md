# Architecture

## Stack decision

The master directive prefers Flutter + Supabase but explicitly allows a
different stack when better suited, with the reasons documented. Decision:

**TypeScript monorepo — Fastify + PostgreSQL backend, React (Vite) web frontend.**

Reasons:
1. **Server-authoritative anti-cheat is a hard requirement.** Supabase's
   client-first model (RLS + client queries) makes hiding correct answers,
   server-side timing, and atomic scoring transactions awkward; a real API
   layer expresses them directly. PostgreSQL is retained as required.
2. **Verifiability.** The build environment has Node + PostgreSQL 16 +
   Chromium; every layer here is actually run and tested end-to-end (73
   automated tests + browser E2E). A Flutter build could not be executed or
   verified in this environment.
3. **One language across the stack** (TypeScript) with shared conventions;
   the API is a clean REST surface that a future Flutter client can consume
   as-is — nothing in the backend is web-specific.

## Layers

```
web/  (Presentation)         React SPA — rendering, input, i18n; no business rules
server/src/modules/*         Application + Domain — one module per bounded context
server/src/modules/questions/engine/   Pure domain core (no I/O): registry, families, scoring
server/src/db/               Infrastructure — pool, SQL migrations, seed
server/src/core/             Cross-cutting: errors, settings, audit, rate limiting
server/src/plugins/          HTTP concerns: identity, RBAC guards
server/src/jobs/             Background scheduler (monthly rollover, expiry, quality, reminders)
```

Modules: `auth`, `users`, `categories`, `questions` (+`engine`), `quizzes`
(pool, attempts), `scoring`, `leaderboards`, `challenges`, `monthly`,
`tournaments`, `groups`, `gamification`, `notifications`, `stats`, `search`,
`admin`. Each owns its routes/service; cross-module completion effects go
through `contextHooks` (registered callbacks) to avoid circular imports.

## Universal Question Engine

The heart of the system (`server/src/modules/questions/engine/`):

- **`QuestionTypeRegistry`** — maps each of the 80 type ids to a
  `QuestionTypeSpec { family, scored, manualReview, defaults, media }`.
- **Families** (13 interaction primitives) implement the real logic:
  `single_choice`, `multi_choice`, `text`, `numeric`, `ordering`,
  `matching`, `categorization`, `hotspot`, `grid`, `confidence`,
  `flashcard`, `unscored`, `submission`, plus `composite` (delegates each
  part back into the registry; nesting is validated out).
- Every family implements:
  - `validate(question) → errors[]` — structural + semantic validation
    (empty prompts, missing/duplicate options, non-permutation orders,
    unknown references, invalid regions…).
  - `score(question, answer) → { outcome, ratio, detail }` — never throws
    on malformed input; ratio ∈ [0,1] with per-question partial-credit
    opt-in.
  - `present(question, rng) → sanitized content` — strips correct answers,
    shuffles options/items (ordering never presents the correct order).
- **Text matching** normalizes case/whitespace/punctuation and Arabic
  (diacritics, alef/yaa/taa-marbuta variants), with configurable Levenshtein
  typo tolerance and exact/contains modes. **Numeric matching** parses
  fractions, percents, Arabic-Indic digits, decimal commas, and supports
  absolute/relative tolerances.

Adding a new type: register the id → family (+defaults). The web client
fetches the registry (`GET /quizzes/question-types`) and picks the renderer
by family, so most new types need zero client changes.

## Quiz flow (server-authoritative)

```
POST /quizzes/start        server picks pool questions (category/difficulty/
                           language/type/tag filters, unanswered-first,
                           quality-gated, randomized), computes per-question
                           time limits + overall deadline, stores attempt,
                           returns sanitized questions (no answers).
POST /attempts/:id/answers server computes elapsed time from its own
                           timestamps; timeout ⇒ 0; scores via registry;
                           computes points (+speed bonus); unique(attempt,
                           question) blocks duplicates; foreign/duplicate/
                           too-fast submissions raise suspicious flags.
POST /attempts/:id/submit  transaction: skip-fill unanswered, totals, XP,
                           level, timezone-aware streak, user + category
                           stats, daily activity, leaderboard upserts (+
                           write-through snapshot invalidation), criteria-
                           driven achievements, notifications; then context
                           hooks (challenge completion, tournament match
                           resolution + bracket advancement).
```

## Ranking

Ordering everywhere: `points DESC, total_time_ms ASC, correct DESC,
last_scored_at ASC`. `leaderboard_scores` (user, scope, scope_key) is the
source of truth; hot boards are cached in `leaderboard_snapshots` with a TTL
and invalidated on write. Scopes: global, country, category, daily/weekly/
monthly periods, group, friends, challenge, monthly_challenge, tournament.

## Background jobs

In-process scheduler (`jobs/scheduler.ts`), each job an isolated function so
it can move to a dedicated worker: monthly-challenge rollover & closing,
attempt/challenge expiry, rolling question-quality recompute, snapshot
cleanup, streak-risk reminders.

## Frontend

React SPA with: context providers (auth, i18n AR/EN with RTL, theme),
an API client with refresh rotation and network retry/backoff, family-based
`QuestionRenderer`, and screens for every feature. No business logic client-
side — all outcomes come from the API.
