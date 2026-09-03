# Testing

```bash
npm test                      # all suites (server workspace, Vitest)
npm run test:watch --workspace=server
```

Integration tests use `DATABASE_URL_TEST` (real PostgreSQL, truncated
between tests) and run serially in a single fork. `NODE_ENV=test` disables
rate limiting (which has its own unit tests) and background jobs.

## Suites

**`test/engine.test.ts` — Universal Question Engine (unit)**
- All 80 required type ids registered; unknown types rejected.
- Per-family scoring: single/multi choice (partial credit + negative
  marking), text (Arabic normalization, typo tolerance, case/whitespace),
  numeric (fractions, percents, Arabic digits, tolerances; unparseable ⇒
  incorrect, empty ⇒ skipped), ordering (positional partial credit; never
  presented in correct order), matching, categorization, hotspot (rect +
  circle), grid puzzles (crossword entries, word-search lists), confidence
  weighting, polls unscored, keyword-scored submissions, flashcards,
  composite delegation (weighted parts, sanitization, no nested composites,
  never throws on malformed answers).
- Validators: empty prompts, missing/duplicate options, correct-answer
  references, permutation checks.

**`test/unit.test.ts` — engines & utilities**
- Points engine: base points, difficulty defaults, speed bonus curve and
  disable switch, partial scaling, zero for wrong/timeout/skip, unscored
  types. Level curve, timezone-aware local dates, ISO week keys, CSV
  parser round-trip (quotes/commas/newlines/Arabic), rate limiter windows,
  duplicate-detection hash stability.

**`test/integration.test.ts` — API on real PostgreSQL**
- Auth: register/login, refresh rotation + replay rejection, wrong
  password, duplicate accounts, banned users, full password-reset flow,
  guest mode + guest restrictions.
- Quiz flow: sanitization (no answer leakage), correct scoring, review
  content; duplicate answer 409, double submit 409, foreign-question 400 —
  all with suspicious flags persisted; server-side timeout ⇒ 0; client
  score fields ignored; skip-fill on submit; empty pool 400; other users
  blocked from my attempt (403).
- Ranking: equal points ⇒ faster total time wins.
- Challenges: create → invite (notification) → join by code → identical
  question sets → completion + ranking; expired challenges rejected.
- Monthly: auto-creation, single participation, leaderboard.
- Tournaments: 4 players through a full bracket to a champion.
- Groups: create/join/leaderboard/leave. Admin: RBAC (403s), question
  lifecycle (validate → pending → approve → pool visibility), exact-dup
  rejection, reports flow, settings patching, CSV import strict vs partial
  with row-level errors, export, role-granting rules.

## Browser E2E

`web` is verified with Playwright + the preinstalled Chromium against the
running server: register → play a quiz → result screen → review →
leaderboard → switch to Arabic (RTL) — asserting zero page errors. Script
pattern lives in the session scratchpad; wire it into CI by launching the
server with a test DB and running the same steps.

## End-to-end (Playwright)

- `npm run e2e --workspace=web` — smoke test of the static demo build served under `/quiz/` (mobile AR + desktop EN).
- `npm run e2e:full --workspace=web` — full stack: real API + PostgreSQL + built SPA. Start the server with
  `SEED_ON_BOOT=true SEED_ADMIN_PASSWORD='ChangeMe123!'`, then run with `BASE_URL=http://127.0.0.1:3001`.
  Covers register → ranked round → leaderboard → admin panel, and horizontal overflow at 390px.
  Both run in CI (`e2e` and `fullstack` jobs). Locally you may set `PLAYWRIGHT_CHROMIUM_PATH` to a system Chromium.
