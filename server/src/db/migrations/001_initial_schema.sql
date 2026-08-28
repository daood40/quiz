-- =====================================================================
-- QUIZ PLATFORM — initial schema
-- PostgreSQL 16. All scoring/validation is server-authoritative.
-- =====================================================================

-- ---------- USERS & AUTH ----------

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext UNIQUE,
  username      text UNIQUE NOT NULL CHECK (char_length(username) BETWEEN 3 AND 32),
  display_name  text NOT NULL DEFAULT '',
  password_hash text,
  role          text NOT NULL DEFAULT 'user'
                CHECK (role IN ('user','moderator','editor','admin','super_admin')),
  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','suspended','banned','deleted')),
  is_guest      boolean NOT NULL DEFAULT false,
  email_verified_at timestamptz,
  avatar        text NOT NULL DEFAULT '',
  country       text NOT NULL DEFAULT '',
  language      text NOT NULL DEFAULT 'en' CHECK (language IN ('ar','en')),
  timezone      text NOT NULL DEFAULT 'UTC',
  xp            bigint NOT NULL DEFAULT 0 CHECK (xp >= 0),
  level         int NOT NULL DEFAULT 1 CHECK (level >= 1),
  total_points  bigint NOT NULL DEFAULT 0,
  current_streak int NOT NULL DEFAULT 0,
  longest_streak int NOT NULL DEFAULT 0,
  last_activity_date date,
  plan          text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','premium')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_role ON users (role);
CREATE INDEX idx_users_status ON users (status);
CREATE INDEX idx_users_country ON users (country) WHERE country <> '';

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);

CREATE TABLE password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE email_verification_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- TAXONOMY ----------

CREATE TABLE categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  name        jsonb NOT NULL,                 -- {"ar": "...", "en": "..."}
  description jsonb NOT NULL DEFAULT '{}',
  parent_id   uuid REFERENCES categories(id) ON DELETE SET NULL,
  icon        text NOT NULL DEFAULT '',
  color       text NOT NULL DEFAULT '',
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_categories_parent ON categories (parent_id);
CREATE INDEX idx_categories_active_order ON categories (is_active, sort_order);

-- ---------- QUESTIONS (Universal Question Model) ----------

CREATE TABLE questions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text NOT NULL,                       -- registry type id (e.g. multiple_choice)
  category_id     uuid REFERENCES categories(id) ON DELETE SET NULL,
  subcategory_id  uuid REFERENCES categories(id) ON DELETE SET NULL,
  difficulty      text NOT NULL DEFAULT 'medium'
                  CHECK (difficulty IN ('easy','medium','hard','expert')),
  language        text NOT NULL DEFAULT 'en' CHECK (language IN ('ar','en')),
  content         jsonb NOT NULL,                      -- type-specific: prompt, options, media refs...
  correct_answer  jsonb NOT NULL DEFAULT 'null',       -- NEVER exposed through public APIs
  configuration   jsonb NOT NULL DEFAULT '{}',         -- shuffle, partial credit, hints...
  points          int NOT NULL DEFAULT 10 CHECK (points BETWEEN 0 AND 1000),
  time_limit_sec  int CHECK (time_limit_sec BETWEEN 5 AND 3600),
  explanation     jsonb NOT NULL DEFAULT '{}',
  tags            text[] NOT NULL DEFAULT '{}',
  source          text NOT NULL DEFAULT '',
  source_url      text NOT NULL DEFAULT '',
  source_reference text NOT NULL DEFAULT '',
  verification_status text NOT NULL DEFAULT 'unverified'
                  CHECK (verification_status IN ('unverified','verified','disputed')),
  verified_at     timestamptz,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','pending_review','approved','rejected','archived')),
  review_note     text NOT NULL DEFAULT '',
  quality_score   numeric(5,2) NOT NULL DEFAULT 50 CHECK (quality_score BETWEEN 0 AND 100),
  content_hash    text NOT NULL DEFAULT '',            -- normalized hash for duplicate detection
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_questions_pool
  ON questions (status, category_id, difficulty, language, type);
CREATE INDEX idx_questions_tags ON questions USING gin (tags);
CREATE INDEX idx_questions_hash ON questions (content_hash);
CREATE INDEX idx_questions_created_by ON questions (created_by);
CREATE INDEX idx_questions_status_created ON questions (status, created_at DESC);

CREATE TABLE question_stats (
  question_id    uuid PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  attempts       bigint NOT NULL DEFAULT 0,
  correct        bigint NOT NULL DEFAULT 0,
  incorrect      bigint NOT NULL DEFAULT 0,
  partial        bigint NOT NULL DEFAULT 0,
  timeouts       bigint NOT NULL DEFAULT 0,
  skips          bigint NOT NULL DEFAULT 0,
  total_time_ms  bigint NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE question_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  reason       text NOT NULL CHECK (reason IN
               ('wrong_answer','wrong_question','typo','duplicate','offensive','technical','other')),
  details      text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'open'
               CHECK (status IN ('open','reviewing','resolved','dismissed')),
  resolved_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  resolution   text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);
CREATE INDEX idx_question_reports_status ON question_reports (status, created_at DESC);
CREATE INDEX idx_question_reports_question ON question_reports (question_id);

-- ---------- QUIZZES & ATTEMPTS ----------

CREATE TABLE quizzes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title          jsonb NOT NULL DEFAULT '{}',
  mode           text NOT NULL DEFAULT 'practice'
                 CHECK (mode IN ('practice','timed','daily','challenge','competitive',
                                 'tournament','monthly','random','category','difficulty','custom')),
  category_id    uuid REFERENCES categories(id) ON DELETE SET NULL,
  difficulty     text CHECK (difficulty IN ('easy','medium','hard','expert')),
  question_count int NOT NULL DEFAULT 10 CHECK (question_count BETWEEN 1 AND 200),
  question_ids   uuid[] NOT NULL DEFAULT '{}',   -- fixed set (admin quizzes / challenges); empty = pool-picked
  rules          jsonb NOT NULL DEFAULT '{}',
  time_limit_sec int,
  starts_at      timestamptz,
  ends_at        timestamptz,
  status         text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('draft','scheduled','active','paused','ended','archived')),
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_quizzes_mode_status ON quizzes (mode, status);

CREATE TABLE attempts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quiz_id          uuid REFERENCES quizzes(id) ON DELETE SET NULL,
  mode             text NOT NULL DEFAULT 'practice',
  context_type     text NOT NULL DEFAULT 'solo'
                   CHECK (context_type IN ('solo','challenge','monthly','tournament','group','daily')),
  context_id       uuid,                                -- challenge/monthly/tournament-match id
  question_ids     uuid[] NOT NULL,                     -- server-selected order
  question_meta    jsonb NOT NULL DEFAULT '{}',         -- per-question server data (shuffle maps, deadlines)
  status           text NOT NULL DEFAULT 'in_progress'
                   CHECK (status IN ('in_progress','submitted','expired','abandoned')),
  score            int NOT NULL DEFAULT 0,
  max_score        int NOT NULL DEFAULT 0,
  correct_count    int NOT NULL DEFAULT 0,
  incorrect_count  int NOT NULL DEFAULT 0,
  partial_count    int NOT NULL DEFAULT 0,
  timeout_count    int NOT NULL DEFAULT 0,
  skipped_count    int NOT NULL DEFAULT 0,
  started_at       timestamptz NOT NULL DEFAULT now(),
  submitted_at     timestamptz,
  deadline_at      timestamptz,                         -- server-enforced overall deadline
  server_duration_ms bigint,
  xp_awarded       int NOT NULL DEFAULT 0,
  flags            jsonb NOT NULL DEFAULT '[]',         -- anti-cheat flags
  suspicion        text NOT NULL DEFAULT 'none'
                   CHECK (suspicion IN ('none','flagged','suspicious','under_review','cleared')),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_attempts_user ON attempts (user_id, created_at DESC);
CREATE INDEX idx_attempts_context ON attempts (context_type, context_id);
CREATE INDEX idx_attempts_status ON attempts (status) WHERE status = 'in_progress';
CREATE INDEX idx_attempts_suspicion ON attempts (suspicion) WHERE suspicion <> 'none';
-- one live attempt per user per competitive context
CREATE UNIQUE INDEX uq_attempts_one_per_context
  ON attempts (user_id, context_type, context_id)
  WHERE context_type <> 'solo' AND status IN ('in_progress','submitted');

CREATE TABLE attempt_answers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id     uuid NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  question_id    uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  answer         jsonb,
  outcome        text NOT NULL
                 CHECK (outcome IN ('correct','incorrect','partial','timeout','skipped')),
  score          int NOT NULL DEFAULT 0,
  max_score      int NOT NULL DEFAULT 0,
  credit_ratio   numeric(5,4) NOT NULL DEFAULT 0,
  time_taken_ms  int NOT NULL DEFAULT 0,
  answered_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, question_id)                      -- duplicate-submission protection
);
CREATE INDEX idx_attempt_answers_question ON attempt_answers (question_id);

CREATE TABLE suspicious_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  attempt_id  uuid REFERENCES attempts(id) ON DELETE CASCADE,
  kind        text NOT NULL,        -- fast_answer, late_submit, replay, dup_submit, rate_abuse...
  details     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_suspicious_events_user ON suspicious_events (user_id, created_at DESC);

-- ---------- CHALLENGES ----------

CREATE TABLE challenges (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text UNIQUE NOT NULL,                  -- shareable join code
  title          text NOT NULL DEFAULT '',
  creator_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id       uuid,                                  -- FK added after groups table
  category_id    uuid REFERENCES categories(id) ON DELETE SET NULL,
  difficulty     text CHECK (difficulty IN ('easy','medium','hard','expert')),
  question_ids   uuid[] NOT NULL,                       -- same set for all participants (fairness)
  question_count int NOT NULL,
  time_limit_sec int,
  status         text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','active','completed','expired','cancelled')),
  starts_at      timestamptz,
  expires_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_challenges_creator ON challenges (creator_id);
CREATE INDEX idx_challenges_status ON challenges (status, expires_at);

CREATE TABLE challenge_participants (
  challenge_id uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempt_id   uuid REFERENCES attempts(id) ON DELETE SET NULL,
  invited_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  status       text NOT NULL DEFAULT 'invited'
               CHECK (status IN ('invited','joined','completed','declined')),
  joined_at    timestamptz,
  completed_at timestamptz,
  PRIMARY KEY (challenge_id, user_id)
);
CREATE INDEX idx_challenge_participants_user ON challenge_participants (user_id);

-- ---------- MONTHLY CHALLENGES ----------

CREATE TABLE monthly_challenges (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month     text UNIQUE NOT NULL,                  -- '2026-08'
  title          jsonb NOT NULL DEFAULT '{}',
  question_ids   uuid[] NOT NULL DEFAULT '{}',
  rules          jsonb NOT NULL DEFAULT '{}',
  rewards        jsonb NOT NULL DEFAULT '{}',
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL,
  status         text NOT NULL DEFAULT 'active'
                 CHECK (status IN ('scheduled','active','ended','archived')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------- TOURNAMENTS ----------

CREATE TABLE tournaments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title          jsonb NOT NULL DEFAULT '{}',
  kind           text NOT NULL DEFAULT 'weekly'
                 CHECK (kind IN ('daily','weekly','monthly','special')),
  category_id    uuid REFERENCES categories(id) ON DELETE SET NULL,
  difficulty     text CHECK (difficulty IN ('easy','medium','hard','expert')),
  rules          jsonb NOT NULL DEFAULT '{}',
  max_players    int NOT NULL DEFAULT 64 CHECK (max_players BETWEEN 2 AND 100000),
  questions_per_match int NOT NULL DEFAULT 10,
  status         text NOT NULL DEFAULT 'registration'
                 CHECK (status IN ('draft','registration','running','completed','cancelled')),
  starts_at      timestamptz,
  ends_at        timestamptz,
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tournaments_status ON tournaments (status, starts_at);

CREATE TABLE tournament_participants (
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seed          int,
  eliminated_in_round int,
  final_rank    int,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, user_id)
);

CREATE TABLE tournament_rounds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_number  int NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','running','completed')),
  starts_at     timestamptz,
  ends_at       timestamptz,
  UNIQUE (tournament_id, round_number)
);

CREATE TABLE tournament_matches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id      uuid NOT NULL REFERENCES tournament_rounds(id) ON DELETE CASCADE,
  match_number  int NOT NULL,
  player1_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  player2_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  question_ids  uuid[] NOT NULL DEFAULT '{}',           -- identical questions for both players
  player1_attempt_id uuid REFERENCES attempts(id) ON DELETE SET NULL,
  player2_attempt_id uuid REFERENCES attempts(id) ON DELETE SET NULL,
  winner_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','running','completed','walkover')),
  UNIQUE (round_id, match_number)
);
CREATE INDEX idx_tournament_matches_players ON tournament_matches (player1_id, player2_id);

-- ---------- GROUPS ----------

CREATE TABLE groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  code        text UNIQUE NOT NULL,                     -- join code
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_public   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE group_members (
  group_id  uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX idx_group_members_user ON group_members (user_id);

ALTER TABLE challenges
  ADD CONSTRAINT fk_challenges_group
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL;

-- ---------- SOCIAL ----------

CREATE TABLE friendships (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  friend_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, friend_id),
  CHECK (user_id <> friend_id)
);

-- ---------- GAMIFICATION ----------

CREATE TABLE achievements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  name        jsonb NOT NULL,
  description jsonb NOT NULL DEFAULT '{}',
  icon        text NOT NULL DEFAULT '',
  -- criteria drives automatic evaluation: {"metric":"correct_total","gte":100}
  criteria    jsonb NOT NULL,
  xp_reward   int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_achievements (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id uuid NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  earned_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, achievement_id)
);

CREATE TABLE xp_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     int NOT NULL,
  reason     text NOT NULL,        -- correct_answer, quiz_completion, achievement, streak...
  ref_id     uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_xp_events_user ON xp_events (user_id, created_at DESC);

-- ---------- USER AGGREGATE STATS ----------

CREATE TABLE user_stats (
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  quizzes_completed bigint NOT NULL DEFAULT 0,
  questions_answered bigint NOT NULL DEFAULT 0,
  correct_total    bigint NOT NULL DEFAULT 0,
  incorrect_total  bigint NOT NULL DEFAULT 0,
  timeout_total    bigint NOT NULL DEFAULT 0,
  skipped_total    bigint NOT NULL DEFAULT 0,
  total_time_ms    bigint NOT NULL DEFAULT 0,
  best_score       int NOT NULL DEFAULT 0,
  perfect_quizzes  bigint NOT NULL DEFAULT 0,
  per_category     jsonb NOT NULL DEFAULT '{}',   -- {catId: {answered, correct}}
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE daily_activity (
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day       date NOT NULL,
  quizzes   int NOT NULL DEFAULT 0,
  questions int NOT NULL DEFAULT 0,
  correct   int NOT NULL DEFAULT 0,
  points    int NOT NULL DEFAULT 0,
  xp        int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- ---------- LEADERBOARDS ----------

-- Period scores are the ranking source of truth; heavier boards read from
-- cached snapshots refreshed by background jobs.
CREATE TABLE leaderboard_scores (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope        text NOT NULL CHECK (scope IN ('global','country','category','group','daily','weekly','monthly','tournament','monthly_challenge','challenge')),
  scope_key    text NOT NULL DEFAULT '',   -- country code / category id / group id / period key
  points       bigint NOT NULL DEFAULT 0,
  correct      bigint NOT NULL DEFAULT 0,
  total_time_ms bigint NOT NULL DEFAULT 0,
  last_scored_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, scope, scope_key)
);
CREATE INDEX idx_leaderboard_rank
  ON leaderboard_scores (scope, scope_key, points DESC, total_time_ms ASC, correct DESC, last_scored_at ASC);

CREATE TABLE leaderboard_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       text NOT NULL,
  scope_key   text NOT NULL DEFAULT '',
  entries     jsonb NOT NULL,             -- [{rank,userId,username,points,...}]
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, scope_key)
);

-- ---------- NOTIFICATIONS ----------

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL,   -- daily_challenge, monthly_challenge, tournament, challenge_invite,
                              -- achievement, rank_change, streak_reminder, system
  title      jsonb NOT NULL DEFAULT '{}',
  body       jsonb NOT NULL DEFAULT '{}',
  data       jsonb NOT NULL DEFAULT '{}',
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications (user_id, created_at DESC);
CREATE INDEX idx_notifications_unread ON notifications (user_id) WHERE read_at IS NULL;

-- ---------- ADMIN / OPS ----------

CREATE TABLE app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,           -- auth.login, quiz.started, admin.question.approved...
  entity     text NOT NULL DEFAULT '',
  entity_id  text NOT NULL DEFAULT '',
  details    jsonb NOT NULL DEFAULT '{}',
  ip         text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_actor ON audit_logs (actor_id, created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs (action, created_at DESC);

CREATE TABLE analytics_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid,
  kind       text NOT NULL,          -- quiz_start, quiz_complete, session_start...
  properties jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_analytics_kind_time ON analytics_events (kind, created_at);
CREATE INDEX idx_analytics_user_time ON analytics_events (user_id, created_at);

-- citext needed for case-insensitive email uniqueness
-- (extension created in 000 below if missing — kept here for clarity)
