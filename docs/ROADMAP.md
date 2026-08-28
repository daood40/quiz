# Roadmap

## Delivered (v1.0)

- Monorepo (Fastify + PostgreSQL 16 API, React SPA), env-driven config,
  SQL migrations, seeds, 73 automated tests + browser E2E.
- Universal Question Engine: registry, 13 families, **80 question types**
  with validation, scoring, partial credit, AR/EN normalization, sanitized
  presentation; duplicate detection (hash + trigram).
- Server-authoritative quiz engine: pool selection, per-question server
  timing, timeout/duplicate/replay/foreign protection, suspicious-activity
  flags + admin review queue (no auto-bans).
- Scoring engine (settings-driven points, difficulty defaults, speed
  bonus), ranking engine with full tie-breakers, cached leaderboards
  (global/country/category/period/friends/group/context scopes).
- Challenges (codes, invites, identical sets), auto-created monthly
  challenges, single-elimination tournaments (rounds→matches→results,
  byes, walkovers, final ranks), groups.
- Gamification: XP events, level curve, timezone-aware streaks with
  milestones, criteria-driven achievements (admin-creatable),
  notifications (invites, achievements, streak risk, tournament wins).
- Statistics (personal dashboard, per-category, 90-day activity) and
  admin analytics (DAU/MAU, starts/completions, popular categories,
  hardest questions, question quality scores).
- Admin panel: KPIs, review workflow with bulk actions, CSV/JSON
  import/export with row-level validation, user management (RBAC),
  reports, anti-cheat queue, live settings, audit log.
- AR/EN with RTL, light/dark, responsive, accessibility affordances
  (focus rings, aria labels, touch targets, reduced motion).
- Subscription-ready: `users.plan` (free/premium) + settings gates;
  payment-provider-agnostic by design.

## Next

1. **Media pipeline** — object storage + CDN, upload UI for image/audio/
   video question types (model + renderers already accept media URLs).
2. **Email delivery** — provider adapter (SES/Postmark) for verification,
   reset, and notification digests (tokens/flows already in place).
3. **Realtime** — WebSocket presence for live head-to-head play and live
   leaderboard ticks.
4. **Flutter mobile client** — consume the existing `/api/v1` surface.
5. **Payments** — subscription checkout behind the existing plan flags
   (provider-agnostic module).
6. **AI assistance** — question suggestion/tagging/duplicate triage feeding
   the *pending_review* queue (human approval stays mandatory).
7. **Redis** — rate limiting + leaderboard cache for multi-instance scale;
   background worker extraction.
8. **Adaptive difficulty** — per-user ability estimates driving the pool
   engine (`adaptive_question` composite type already reserved).
