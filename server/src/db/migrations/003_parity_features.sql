-- Competitor-parity + directive v2 leftovers:
--   per-option answer distribution (Millionaire "ask the audience"),
--   question versions (edits re-enter review, full history),
--   bookmarks (Quizlet-style "save to study").

CREATE TABLE question_option_stats (
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_id   text NOT NULL,
  picks       bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (question_id, option_id)
);

CREATE TABLE question_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  version     int NOT NULL,
  snapshot    jsonb NOT NULL,           -- full row before the edit
  edited_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_id, version)
);
ALTER TABLE questions ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1;

CREATE TABLE question_bookmarks (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);
CREATE INDEX idx_question_bookmarks_user ON question_bookmarks (user_id, created_at DESC);
