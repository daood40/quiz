# Security

## Authentication
- Passwords: bcrypt (cost from `BCRYPT_ROUNDS`, 12 in production); login
  compares against a dummy hash when the user is unknown to reduce
  user-enumeration timing signals; password-reset never reveals whether an
  email exists.
- Sessions: short-lived JWT access tokens (default 15 min, issuer-pinned) +
  opaque refresh tokens stored **only as SHA-256 hashes**, rotated on every
  refresh (reuse of a rotated token ⇒ 401). Password change/reset, ban and
  account deletion revoke outstanding refresh tokens.
- Email verification and password reset use single-use, expiring hashed
  tokens.

## Authorization (RBAC)
Roles: `user < moderator < editor < admin < super_admin` with hierarchy
checks server-side on every admin route. Guests hold a restricted identity
(no competitions, capped question counts). Moderators cannot act on staff
accounts; only super admins grant admin roles; self-role-change is blocked.
Object ownership is enforced (you can only answer/submit/review your own
attempts; group/challenge membership checked).

## Anti-cheat (server-authoritative)
The client never sends scores — only raw answers. The server:
- keeps correct answers server-side (presented content is sanitized;
  composite parts sanitized recursively);
- timestamps every event and computes per-question elapsed time itself;
  answers past the limit (+grace) or overall deadline score **timeout = 0**;
- blocks duplicate submissions (DB unique constraint) and double submits
  (status checks inside row-locked transactions);
- one live attempt per competitive context (partial unique index);
- flags: too-fast correct answers, foreign questions, duplicate submissions,
  late submits — recorded in `suspicious_events` + attempt `flags`, with
  escalation `flagged → suspicious`; **no automatic bans** — an admin review
  queue decides (`cleared` / `under_review`).

## Transport & API hygiene
- Rate limiting: global per-IP/user sliding window + stricter buckets on
  auth, quiz start, answering and reporting (429). Swap the in-memory store
  for Redis for multi-instance deployments.
- Validation: every body/query is zod-validated (types, ranges, enums,
  lengths); SQL access is exclusively parameterized.
- Error policy: clients get stable codes + safe messages; stack traces,
  SQL errors and internals are logged server-side only.
- CORS restricted to configured origins; JSON body limits (5 MB default,
  import endpoint explicitly larger); React escapes output (no
  dangerouslySetInnerHTML anywhere).
- Secrets only via environment (`.env` is git-ignored; `.env.example` has
  placeholders); JWT secret length enforced in production; no secrets in
  the frontend bundle.

## Auditing
`audit_logs` records auth events, quiz start/completion, admin actions
(review decisions, role/status changes, settings, imports/exports) with
actor, entity, details, IP. `analytics_events` is behavioral and contains no
sensitive payloads. Account deletion anonymizes personal data (soft delete)
while preserving aggregate integrity.
