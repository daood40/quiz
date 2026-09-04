-- 004: production hardening (indexes, timestamps, session invalidation, job telemetry)

-- ---- session invalidation: bans / role changes take effect before the access token expires
ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_valid_after timestamptz NOT NULL DEFAULT '1970-01-01';

-- ---- FK columns used in WHERE / JOIN / cascades that had no index
CREATE INDEX IF NOT EXISTS idx_friendships_friend ON friendships (friend_id, status);
CREATE INDEX IF NOT EXISTS idx_questions_subcategory ON questions (subcategory_id) WHERE subcategory_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_questions_category_status ON questions (category_id, status);
CREATE INDEX IF NOT EXISTS idx_tournament_participants_user ON tournament_participants (user_id);
CREATE INDEX IF NOT EXISTS idx_suspicious_events_attempt ON suspicious_events (attempt_id);
CREATE INDEX IF NOT EXISTS idx_question_bookmarks_question ON question_bookmarks (question_id);
CREATE INDEX IF NOT EXISTS idx_user_achievements_achievement ON user_achievements (achievement_id);
CREATE INDEX IF NOT EXISTS idx_challenges_group ON challenges (group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_challenge_participants_attempt ON challenge_participants (attempt_id) WHERE attempt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_challenge_participants_inviter ON challenge_participants (invited_by) WHERE invited_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attempts_quiz ON attempts (quiz_id) WHERE quiz_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_question_reports_user ON question_reports (user_id);
CREATE INDEX IF NOT EXISTS idx_groups_owner ON groups (owner_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user ON email_verification_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_tournament_matches_player2 ON tournament_matches (player2_id) WHERE player2_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_guest_created ON users (created_at) WHERE is_guest = true;

-- ---- updated_at on mutable state tables + a shared trigger so no code path can forget it
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE monthly_challenges ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE tournament_rounds ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE tournament_rounds ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE tournament_matches ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE tournament_matches ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE groups ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE groups ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE question_reports ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE question_stats ADD COLUMN IF NOT EXISTS quality_computed_at timestamptz;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','questions','categories','quizzes','attempts','challenges','monthly_challenges',
                           'tournaments','tournament_rounds','tournament_matches','groups','question_reports',
                           'question_stats','user_stats','app_settings']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

-- ---- background job telemetry (last run per job; surfaced on /ready)
CREATE TABLE IF NOT EXISTS job_runs (
  name text PRIMARY KEY,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_status text NOT NULL DEFAULT 'idle',   -- idle | ok | error | skipped
  last_error text,
  runs bigint NOT NULL DEFAULT 0,
  failures bigint NOT NULL DEFAULT 0
);
