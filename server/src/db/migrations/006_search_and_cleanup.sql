-- 006: Arabic-aware question search + housekeeping (data-postgres-advanced, data-schema-design)

-- one immutable text view of a question prompt (both languages) so it can be indexed
CREATE OR REPLACE FUNCTION question_prompt_text(content jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(coalesce(content->>'prompt', '') || ' ' || coalesce(content->'prompt'->>'en', '') || ' ' || coalesce(content->'prompt'->>'ar', ''))
$$;

-- Arabic normalisation in SQL (mirrors engine/normalize.ts): diacritics, tatweel, hamza forms, taa marbuta, alef maqsura
CREATE OR REPLACE FUNCTION arabic_norm(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT translate(
           regexp_replace(lower(coalesce(t, '')), '[ً-ْٰـ]', '', 'g'),
           'أإآٱىؤئة٠١٢٣٤٥٦٧٨٩', 'ااااياييه0123456789')
$$;

-- trigram index: makes ILIKE '%…%' / similarity() on prompts an index scan instead of a full scan
CREATE INDEX IF NOT EXISTS idx_questions_prompt_trgm
  ON questions USING gin (arabic_norm(question_prompt_text(content)) gin_trgm_ops);

-- FK columns that a real delete touches
CREATE INDEX IF NOT EXISTS idx_quizzes_created_by ON quizzes (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tournament_matches_winner ON tournament_matches (winner_id) WHERE winner_id IS NOT NULL;

-- dead soft-delete scaffolding (groups are hard-deleted; nothing reads the column)
ALTER TABLE groups DROP COLUMN IF EXISTS deleted_at;

-- AI ledger: 'pending' rows are quota reservations that were never finalised (crash mid-call)
ALTER TABLE ai_requests DROP CONSTRAINT IF EXISTS ai_requests_status_check;

-- usernames are unique case-insensitively (login and profile URLs already compare lower()).
-- de-duplicate first so the index can never fail on an existing database: the later account gets a suffix.
UPDATE users u SET username = left(u.username, 27) || '_' || left(u.id::text, 4)
WHERE EXISTS (SELECT 1 FROM users v WHERE v.id <> u.id AND lower(v.username) = lower(u.username) AND v.created_at < u.created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (lower(username));
