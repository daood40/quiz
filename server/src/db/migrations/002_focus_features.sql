-- Market-parity features: streak freezes (Duolingo), deterministic daily quiz
-- (question-of-the-day competition), power-ups (Trivia Crack/Quizizz).

ALTER TABLE users ADD COLUMN streak_freezes int NOT NULL DEFAULT 1 CHECK (streak_freezes >= 0);

-- One shared question set per calendar day → everyone competes on equal terms.
CREATE TABLE daily_quizzes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day          date UNIQUE NOT NULL,
  question_ids uuid[] NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Per-attempt power-up usage lives in attempts.question_meta (jsonb); no schema
-- change needed there. This index supports "review my mistakes" pool queries.
CREATE INDEX idx_attempt_answers_wrong
  ON attempt_answers (question_id)
  WHERE outcome IN ('incorrect','timeout');
