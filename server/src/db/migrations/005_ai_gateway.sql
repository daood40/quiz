-- 005: AI gateway request ledger (quotas, cost, audit) — the model never touches user data or approvals
CREATE TABLE IF NOT EXISTS ai_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  kind          text NOT NULL,                       -- draft_questions
  provider      text NOT NULL,
  model         text NOT NULL,
  category_id   uuid REFERENCES categories(id) ON DELETE SET NULL,
  requested     int NOT NULL DEFAULT 0,
  produced      int NOT NULL DEFAULT 0,
  accepted      int NOT NULL DEFAULT 0,              -- drafts that passed validation + dedupe
  input_tokens  int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'ok',          -- ok | error | blocked
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_requests_user_day ON ai_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_requests_day ON ai_requests (created_at DESC);
