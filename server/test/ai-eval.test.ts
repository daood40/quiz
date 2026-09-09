/**
 * AI gateway golden-set runner — reads eval/cases.jsonl and drives every case through the real HTTP path
 * (validation → SOURCE_LOCK → quota → provider → output validation → pending_review) with a scripted,
 * network-free provider. Deterministic: the same file must produce the same verdict on every run.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiProvider, DraftQuestion, DraftRequest, DraftResult } from '../src/modules/ai/provider.js';

// the provider is swapped at module level so the gateway code under test is exactly what runs in production
const scripted = vi.hoisted(() => ({ current: null as AiProvider | null }));
vi.mock('../src/modules/ai/provider.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/modules/ai/provider.js')>();
  return { ...orig, getAiProvider: () => scripted.current };
});

import { query } from '../src/db/pool.js';
import { registry } from '../src/modules/questions/engine/registry.js';
import { api, closeAll, getApp, loginAs, makeAdmin, registerUser, resetDb } from './helpers.js';

interface EvalCase {
  id: string;
  kind: 'draft' | 'review';
  tags: string[];
  mock?: 'deterministic' | 'religious_no_source' | 'bad_index';
  input: {
    categorySlug: string;
    topic?: string;
    language: 'ar' | 'en';
    difficulty: 'easy' | 'medium' | 'hard' | 'expert';
    count: number;
    types: string[];
    repeat?: number;
    source?: string;
    correctAnswer?: string;
  };
  expect: {
    status?: number;
    approveStatus?: number;
    count: number;
    language: 'ar' | 'en';
    types: string[];
    noReligiousWithoutSource: boolean;
    maxPromptLen?: number;
    providerCalls?: number;
    providerTopic?: string;
    providerTopicHasNoAngleBrackets?: boolean;
    blockedRequests?: number;
    errors?: string[];
    scoreAnswer?: { given: string; outcome: string };
  };
}

const casesPath = join(dirname(fileURLToPath(import.meta.url)), '../eval/cases.jsonl');
const cases: EvalCase[] = readFileSync(casesPath, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as EvalCase);

// category fixtures: slug → bilingual name (religious ones prove SOURCE_LOCK on slug and on name)
const CATEGORIES: Record<string, { en: string; ar: string }> = {
  science: { en: 'Science', ar: 'العلوم' },
  history: { en: 'History', ar: 'التاريخ' },
  geography: { en: 'Geography', ar: 'الجغرافيا' },
  sports: { en: 'Sports', ar: 'الرياضة' },
  islamic: { en: 'Islamic knowledge', ar: 'معلومات إسلامية' },
  beliefs: { en: 'World religions', ar: 'معتقدات' },
};

const ARABIC = /[؀-ۿ]/;
const LATIN = /[A-Za-z]/;
function assertLanguage(text: string, lang: 'ar' | 'en', where: string): void {
  if (lang === 'ar') {
    expect(ARABIC.test(text), `${where}: expected Arabic text: ${text}`).toBe(true);
    expect(LATIN.test(text), `${where}: Latin letters in an Arabic prompt: ${text}`).toBe(false);
  } else {
    expect(LATIN.test(text), `${where}: expected English text: ${text}`).toBe(true);
    expect(ARABIC.test(text), `${where}: Arabic letters in an English prompt: ${text}`).toBe(false);
  }
}

/** Deterministic drafts — unique per case id so cross-case duplicates cannot mask a bug. */
function scriptedDrafts(c: EvalCase, req: DraftRequest): DraftQuestion[] {
  const ar = req.language === 'ar';
  const qs: DraftQuestion[] = Array.from({ length: req.count }, (_, i) => ({
    prompt: ar ? `سؤال ${c.id.length + i + 1} عن ${req.categoryName} بمستوى ${req.difficulty === 'easy' ? 'سهل' : 'متقدم'}؟` : `Question ${i + 1} about ${req.categoryName} (${req.difficulty}, case ${c.id})?`,
    options: ar ? ['الإجابة الصحيحة', 'خيار ب', 'خيار ج', 'خيار د'] : ['Correct answer', 'Option B', 'Option C', 'Option D'],
    correctIndex: 0,
    explanation: ar ? 'شرح تجريبي' : 'Mock explanation',
    tags: ['mock'],
  }));
  if (c.mock === 'religious_no_source' && qs[1]) {
    // a leak: the model ignored its rules and produced scripture-based content in a secular category
    qs[1] = { ...qs[1], prompt: 'Which hadith collection is considered the most authentic after the Quran?', tags: ['hadith'] };
  }
  if (c.mock === 'bad_index' && qs[0]) qs[0] = { ...qs[0], correctIndex: 5 };
  return qs;
}

describe('AI eval golden set', () => {
  let token = '';
  const categoryIds: Record<string, string> = {};
  const calls: DraftRequest[] = [];

  beforeAll(async () => {
    await getApp();
  });
  afterAll(async () => {
    await closeAll();
  });
  beforeEach(async () => {
    await resetDb();
    calls.length = 0;
    const u = await registerUser('evaleditor');
    await makeAdmin(u.id, 'editor');
    token = await loginAs('evaleditor');
    for (const [slug, name] of Object.entries(CATEGORIES)) {
      const { rows } = await query<{ id: string }>('INSERT INTO categories (slug, name) VALUES ($1, $2) RETURNING id', [slug, JSON.stringify(name)]);
      categoryIds[slug] = rows[0].id;
    }
  });

  it('has a well-formed, unique golden set with the required coverage', () => {
    expect(cases.length).toBeGreaterThanOrEqual(12);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    const langs = new Set(cases.map((c) => c.input.language));
    const diffs = new Set(cases.map((c) => c.input.difficulty));
    const types = new Set(cases.flatMap((c) => c.input.types));
    expect([...langs].sort()).toEqual(['ar', 'en']);
    expect(['easy', 'medium', 'hard'].every((d) => diffs.has(d as never))).toBe(true);
    expect(['multiple_choice', 'true_false', 'short_answer'].every((t) => types.has(t))).toBe(true);
    expect(cases.some((c) => c.expect.noReligiousWithoutSource && c.expect.status === 403)).toBe(true);
    expect(cases.some((c) => c.mock === 'religious_no_source')).toBe(true);
    for (const c of cases) {
      expect(CATEGORIES[c.input.categorySlug], `${c.id}: unknown category`).toBeDefined();
      expect(c.kind === 'draft' || c.kind === 'review', `${c.id}: kind`).toBe(true);
      expect(Array.isArray(c.tags) && c.tags.length > 0, `${c.id}: tags`).toBe(true);
    }
  });

  for (const c of cases) {
    it(`${c.id} [${c.tags.join(',')}]`, async () => {
      if (c.kind === 'draft') await runDraft(c);
      else await runReview(c);
    });
  }

  async function runDraft(c: EvalCase): Promise<void> {
    scripted.current = {
      name: 'scripted',
      model: 'scripted-1',
      async draftQuestions(req: DraftRequest): Promise<DraftResult> {
        calls.push(req);
        const questions = scriptedDrafts(c, req);
        return { questions, model: 'scripted-1', inputTokens: 10 * req.count, outputTokens: 40 * req.count };
      },
    };
    const body = { categoryId: categoryIds[c.input.categorySlug], language: c.input.language, difficulty: c.input.difficulty, count: c.input.count, topic: c.input.topic };
    let last: { status: number; body: never } | null = null;
    const errors: string[] = [];
    for (let i = 0; i < (c.input.repeat ?? 1); i++) {
      last = await api('/admin/ai/draft-questions', { method: 'POST', token, body });
      errors.length = 0;
      for (const e of ((last.body as { errors?: Array<{ error: string }> }).errors ?? [])) errors.push(e.error);
    }
    expect(last!.status, `${c.id}: status ${JSON.stringify(last!.body)}`).toBe(c.expect.status);

    // what reached the provider
    if (c.expect.providerCalls !== undefined) expect(calls.length, `${c.id}: provider calls`).toBe(c.expect.providerCalls);
    for (const req of calls) {
      expect(req.language).toBe(c.input.language);
      expect(req.difficulty).toBe(c.input.difficulty);
      expect(req.count).toBe(c.input.count);
      expect(req.categoryName).toBe(CATEGORIES[c.input.categorySlug][c.input.language]);
      if (c.expect.providerTopic !== undefined) expect(req.topic).toBe(c.expect.providerTopic);
      if (c.expect.providerTopicHasNoAngleBrackets) expect(req.topic ?? '').toBe(c.input.topic); // the gateway forwards the topic as opaque data; the provider tags it
    }

    // what landed in the database
    const rows = await query<{ type: string; status: string; language: string; difficulty: string; content: { prompt: Record<string, string> }; source: string }>(
      `SELECT type, status, language, difficulty, content, source FROM questions WHERE source = 'ai' ORDER BY created_at`,
    );
    expect(rows.rows.length, `${c.id}: filed drafts`).toBe(c.expect.count);
    expect([...new Set(rows.rows.map((r) => r.type))].sort()).toEqual([...c.expect.types].sort());
    for (const r of rows.rows) {
      expect(r.status).toBe('pending_review'); // never approved by a machine
      expect(r.language).toBe(c.expect.language);
      expect(r.difficulty).toBe(c.input.difficulty);
      const prompt = r.content.prompt[c.expect.language];
      expect(typeof prompt).toBe('string');
      assertLanguage(prompt, c.expect.language, c.id);
      if (c.expect.maxPromptLen) expect(prompt.length).toBeLessThanOrEqual(c.expect.maxPromptLen);
      if (c.expect.noReligiousWithoutSource) expect(prompt).not.toMatch(/hadith|quran|قرآن|حديث/i);
    }
    if (c.expect.errors) expect(errors.sort()).toEqual([...c.expect.errors].sort());
    if (c.expect.blockedRequests !== undefined) {
      const blocked = await query<{ n: string }>(`SELECT count(*) AS n FROM ai_requests WHERE status = 'blocked' AND error = 'source_lock'`);
      expect(Number(blocked.rows[0].n)).toBe(c.expect.blockedRequests);
    }
    if (c.expect.status === 200) {
      const ledger = await query<{ status: string; accepted: number; produced: number }>(`SELECT status, accepted, produced FROM ai_requests ORDER BY created_at DESC LIMIT 1`);
      expect(ledger.rows[0].status).toBe('ok');
      expect(Number(ledger.rows[0].produced)).toBe(c.input.count);
    }
    if (c.expect.status >= 400 && c.expect.providerCalls === 0) {
      expect(calls.length).toBe(0);
      expect(rows.rows.length).toBe(0);
    }
  }

  /** Review gate: a human-written question of the requested type in the category — approval needs a source only for religion. */
  async function runReview(c: EvalCase): Promise<void> {
    const type = c.input.types[0];
    const ar = c.input.language === 'ar';
    const prompt = ar ? `سؤال مراجعة ${c.id.length} من نوع ${type === 'true_false' ? 'صح أو خطأ' : 'إجابة قصيرة'}؟` : `Review question for ${c.id.replace(/_/g, ' ')}?`;
    const content = type === 'true_false'
      ? { prompt: { [c.input.language]: prompt }, options: [{ id: 'true', text: ar ? 'صح' : 'True' }, { id: 'false', text: ar ? 'خطأ' : 'False' }] }
      : { prompt: { [c.input.language]: prompt } };
    const correctAnswer = type === 'true_false' ? 'true' : (c.input.correctAnswer ?? (ar ? 'الجواب' : 'answer'));
    const created = await api('/admin/questions', {
      method: 'POST', token,
      body: { type, categoryId: categoryIds[c.input.categorySlug], language: c.input.language, difficulty: c.input.difficulty, content, correctAnswer, source: c.input.source ?? '' },
    });
    expect(created.status, `${c.id}: create ${JSON.stringify(created.body)}`).toBe(200);
    const id = (created.body as { id: string }).id;
    const approve = await api(`/admin/questions/${id}/status`, { method: 'POST', token, body: { status: 'approved' } });
    expect(approve.status, `${c.id}: approve ${JSON.stringify(approve.body)}`).toBe(c.expect.approveStatus);
    const row = (await query<{ type: string; status: string; language: string; content: Record<string, unknown>; correct_answer: unknown; configuration: Record<string, unknown> }>(
      'SELECT type, status, language, content, correct_answer, configuration FROM questions WHERE id = $1', [id])).rows[0];
    expect([row.type]).toEqual(c.expect.types);
    expect(row.language).toBe(c.expect.language);
    expect(row.status).toBe(c.expect.approveStatus === 200 ? 'approved' : 'draft');
    assertLanguage((row.content.prompt as Record<string, string>)[c.expect.language], c.expect.language, c.id);
    const filed = await query<{ n: string }>('SELECT count(*) AS n FROM questions');
    expect(Number(filed.rows[0].n)).toBe(c.expect.count);
    if (c.expect.noReligiousWithoutSource && c.expect.approveStatus !== 200) {
      expect((approve.body as { error: { message: string } }).error.message).toMatch(/source/i);
    }
    if (c.expect.scoreAnswer) {
      const r = registry.score(row.type, { type: row.type, content: row.content, correctAnswer: row.correct_answer, configuration: row.configuration }, c.expect.scoreAnswer.given);
      expect(r.outcome).toBe(c.expect.scoreAnswer.outcome);
    }
  }
});
