# API

Base: `/api/v1`. Auth: `Authorization: Bearer <accessToken>`. Errors:
`{ "error": { "code", "message", "details?" } }` with proper HTTP status
(400/401/403/404/409/422/429/500).

## /auth
| Method | Path | Notes |
|---|---|---|
| POST | /auth/register | email, username, password, displayName?, language?, country? |
| POST | /auth/login | identifier (email or username) + password |
| POST | /auth/guest | guest session (language?) |
| POST | /auth/refresh | rotates refresh token |
| POST | /auth/logout | revokes refresh token(s) |
| POST | /auth/forgot-password | always 200; token emailed (returned in non-prod) |
| POST | /auth/reset-password | token + password (single-use) |
| POST | /auth/verify-email | token |
| POST | /auth/change-password | auth; current + new |
| DELETE | /auth/account | auth; anonymizing soft delete |

## /users, /stats, /search
- `GET /users/me` · `PATCH /users/me` (displayName, avatar, language, country, timezone)
- `GET /users/:username` — public profile + stats + achievements
- `GET /stats/me` — personal dashboard (totals, accuracy, best/weakest category, 90-day activity)
- `GET /search?q=&type=all|users|categories|tournaments|groups&limit=&offset=`

## /categories, /questions
- `GET /categories` — active tree + approved-question counts per difficulty
- `POST /questions/:id/report` — reason ∈ wrong_answer|wrong_question|typo|duplicate|offensive|technical|other

## /quizzes (play)
| Method | Path | Notes |
|---|---|---|
| GET | /quizzes/question-types | registry: id, family, scored, media |
| GET | /quizzes/scheduled | active admin-curated quizzes |
| POST | /quizzes/:quizId/start | play a curated quiz (identical fixed set) |
| POST | /quizzes/start | mode (practice·timed·review·daily·…), filters → attemptId + sanitized questions + `untimed` + granted `powerups`. `review` replays your unresolved mistakes; `daily` serves the shared question-of-the-day set (one attempt/day) |
| GET | /quizzes/daily | today's shared quiz status + my attempt |
| POST | /quizzes/attempts/:id/answers | { questionId, answer } → { outcome, points, feedback? } — `feedback` (correct answer + explanation) only in untimed modes |
| POST | /quizzes/attempts/:id/powerups | { kind: fifty_fifty \| time_extend, questionId } — server-side; 50/50 returns wrong-option ids only |
| POST | /quizzes/attempts/:id/submit | totals, XP, streak, achievements |
| GET | /quizzes/attempts/:id | resume data (network recovery) |
| GET | /quizzes/attempts/:id/review | questions + your/correct answers + explanations (post-submit only) |
| GET | /quizzes/attempts | my history (paginated) |

## /leaderboards
- `GET /leaderboards?scope=global|country|category|group|daily|weekly|monthly|friends|challenge|monthly_challenge|tournament&key=&limit=`
  → ranked entries (+`me` with rank when authenticated; cached)
- `GET /leaderboards/me` — my ranks across common scopes

## /challenges
- `POST /challenges` — create (fixed identical question set; invites by username)
- `GET /challenges` · `GET /challenges/:id` — mine / detail + ranked participants
- `POST /challenges/join` — by shareable code
- `POST /challenges/:id/start` — begin my attempt

## /monthly-challenges
- `GET /monthly-challenges/current` — auto-created; details + leaderboard + my status
- `POST /monthly-challenges/current/start` — one participation per month
- `GET /monthly-challenges/history` · `GET /monthly-challenges/:id/leaderboard`

## /tournaments
- `GET /tournaments` · `GET /tournaments/:id` — list / bracket detail
- `POST /tournaments` (admin) · `POST /tournaments/:id/start` (admin — seeds & builds round 1)
- `POST /tournaments/:id/join` — during registration
- `POST /tournaments/:id/play` — start my current match attempt

## /groups
- `POST /groups` · `GET /groups` (mine + discover) · `GET /groups/:id`
- `POST /groups/join` (code or public id) · `POST /groups/:id/leave` · `POST /groups/:id/invite`

## /friends
- `GET /friends` — friends + incoming/outgoing requests
- `POST /friends/request` { username } · `POST /friends/respond` { userId, accept } · `DELETE /friends/:userId`

## /achievements, /notifications
- `GET /achievements` (+earned for auth) · `GET /achievements/progress` (XP/level curve)
- `GET /notifications` · `POST /notifications/read` (ids? or all)

## /admin (RBAC-guarded)
- `GET /admin/dashboard` · `GET /admin/analytics` (moderator+)
- Questions (editor+ to write, moderator+ to review): `GET|POST /admin/questions`,
  `POST /admin/questions/validate`, `GET|PUT /admin/questions/:id`,
  `POST /admin/questions/:id/status`, `POST /admin/questions/bulk-status`,
  `DELETE /admin/questions/:id` (admin), `POST /admin/questions/:id/recompute-quality`,
  `GET /admin/questions/meta/types`
- Import/export (editor+): `POST /admin/questions/import` (json|csv; strict|partial; row-level errors),
  `GET /admin/questions/export?format=json|csv&…filters`
- Quizzes: `GET /admin/quizzes` (moderator+), `POST /admin/quizzes` (admin — curates a fixed set),
  `POST /admin/quizzes/:id/status` (draft|scheduled|active|paused|ended|archived)
- Users (moderator+): `GET /admin/users`, `GET /admin/users/:id`,
  `POST /admin/users/:id/status`, `POST /admin/users/:id/role` (admin+/super_admin rules)
- Reports (moderator+): `GET /admin/reports`, `POST /admin/reports/:id/resolve`
- Anti-cheat (moderator+): `GET /admin/suspicious`, `POST /admin/suspicious/:attemptId`
- Settings (admin+): `GET|PATCH /admin/settings`
- Categories/achievements (admin+): `POST|PATCH|DELETE /admin/categories*`, `POST /admin/achievements`
- Audit (admin+): `GET /admin/audit`
