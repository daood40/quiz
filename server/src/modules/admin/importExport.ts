import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../../core/audit.js';
import { badRequest } from '../../core/errors.js';
import { query } from '../../db/pool.js';
import { requireRole } from '../../plugins/auth.js';
import { computeContentHash, questionInputSchema, validateQuestionOrThrow } from '../questions/service.js';

/** RFC-4180-ish CSV parser (quotes, escaped quotes, newlines in fields). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

export function toCsv(rows: unknown[][]): string {
  const escape = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM so Excel opens UTF-8 (Arabic) correctly
  return '﻿' + rows.map((r) => r.map(escape).join(',')).join('\r\n');
}

const CSV_COLUMNS = [
  'type', 'category_slug', 'difficulty', 'language', 'prompt_en', 'prompt_ar',
  'options', 'correct_answer', 'points', 'time_limit_sec', 'explanation_en', 'explanation_ar',
  'tags', 'source', 'source_url',
] as const;

interface ImportError {
  row: number;
  field: string;
  error: string;
}

/** Converts one CSV row into a question input; returns errors instead of throwing. */
function csvRowToInput(
  header: string[],
  row: string[],
  rowNum: number,
  categoryMap: Map<string, string>,
): { input?: z.infer<typeof questionInputSchema>; errors: ImportError[] } {
  const errors: ImportError[] = [];
  const get = (col: string): string => {
    const idx = header.indexOf(col);
    return idx >= 0 ? (row[idx] ?? '').trim() : '';
  };
  const type = get('type') || 'multiple_choice';
  const promptEn = get('prompt_en');
  const promptAr = get('prompt_ar');
  if (!promptEn && !promptAr) errors.push({ row: rowNum, field: 'prompt_en', error: 'prompt required (en or ar)' });

  let options: unknown = undefined;
  const optionsRaw = get('options');
  if (optionsRaw) {
    try {
      options = JSON.parse(optionsRaw);
    } catch {
      // pipe-separated simple options: "Paris|London|Berlin"
      options = optionsRaw.split('|').map((t, i) => ({ id: `o${i + 1}`, text: t.trim() }));
    }
  }
  let correctAnswer: unknown = get('correct_answer');
  try {
    correctAnswer = JSON.parse(get('correct_answer'));
  } catch {
    /* keep as string */
  }
  // convenience: correct answer given as option text for choice questions
  if (Array.isArray(options) && typeof correctAnswer === 'string') {
    const match = (options as Array<{ id: string; text?: string }>).find(
      (o) => (o.text ?? '').trim().toLowerCase() === (correctAnswer as string).trim().toLowerCase(),
    );
    if (match) correctAnswer = match.id;
  }

  const categorySlug = get('category_slug');
  const categoryId = categorySlug ? categoryMap.get(categorySlug) ?? null : null;
  if (categorySlug && !categoryId) errors.push({ row: rowNum, field: 'category_slug', error: `unknown category ${categorySlug}` });

  const difficulty = (get('difficulty') || 'medium') as 'easy' | 'medium' | 'hard' | 'expert';
  const language = (get('language') || (promptAr && !promptEn ? 'ar' : 'en')) as 'ar' | 'en';

  const content: Record<string, unknown> = { prompt: { en: promptEn, ar: promptAr } };
  if (options) content.options = options;

  const candidate = {
    type,
    categoryId,
    difficulty,
    language,
    content,
    correctAnswer,
    configuration: {},
    points: get('points') ? Number(get('points')) : undefined,
    timeLimitSec: get('time_limit_sec') ? Number(get('time_limit_sec')) : undefined,
    explanation: { en: get('explanation_en'), ar: get('explanation_ar') },
    tags: get('tags') ? get('tags').split('|').map((t) => t.trim()).filter(Boolean) : [],
    source: get('source'),
    sourceUrl: get('source_url'),
    sourceReference: '',
  };
  const parsed = questionInputSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({ row: rowNum, field: issue.path.join('.'), error: issue.message });
    }
    return { errors };
  }
  return { input: parsed.data, errors };
}

export async function importExportRoutes(app: FastifyInstance): Promise<void> {
  const editor = requireRole('editor');

  /**
   * Import questions from JSON (array of question inputs) or CSV.
   * Validates everything first; only writes when there are zero errors,
   * unless mode=partial (valid rows imported, invalid rows reported).
   */
  app.post('/import', { preHandler: [editor], bodyLimit: 50 * 1024 * 1024 }, async (req) => {
    const bodySchema = z.object({
      format: z.enum(['json', 'csv']),
      data: z.string().min(1),
      mode: z.enum(['strict', 'partial']).default('strict'),
      status: z.enum(['draft', 'pending_review', 'approved']).default('pending_review'),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid import payload', parsed.error.issues);
    const { format, data, mode, status } = parsed.data;

    const cats = await query('SELECT id, slug FROM categories');
    const categoryMap = new Map<string, string>(cats.rows.map((c) => [c.slug, c.id]));

    const inputs: Array<z.infer<typeof questionInputSchema>> = [];
    const errors: ImportError[] = [];

    if (format === 'json') {
      let arr: unknown;
      try {
        arr = JSON.parse(data);
      } catch {
        throw badRequest('Invalid JSON');
      }
      if (!Array.isArray(arr)) throw badRequest('JSON must be an array of questions');
      if (arr.length > 10000) throw badRequest('Import chunk limited to 10000 questions');
      arr.forEach((item, i) => {
        const candidate = item as Record<string, unknown>;
        if (typeof candidate.categorySlug === 'string') {
          candidate.categoryId = categoryMap.get(candidate.categorySlug) ?? null;
          if (!candidate.categoryId)
            errors.push({ row: i + 1, field: 'categorySlug', error: `unknown category ${candidate.categorySlug}` });
        }
        const p = questionInputSchema.safeParse(candidate);
        if (!p.success) {
          for (const issue of p.error.issues) errors.push({ row: i + 1, field: issue.path.join('.'), error: issue.message });
          return;
        }
        try {
          validateQuestionOrThrow(p.data);
          inputs.push(p.data);
        } catch (err) {
          const details = (err as { details?: { errors?: string[] } }).details;
          for (const e of details?.errors ?? [(err as Error).message]) errors.push({ row: i + 1, field: 'content', error: e });
        }
      });
    } else {
      const rows = parseCsv(data);
      if (rows.length < 2) throw badRequest('CSV must contain a header row and at least one data row');
      const header = rows[0].map((h) => h.trim().toLowerCase());
      rows.slice(1).forEach((row, i) => {
        const { input, errors: rowErrors } = csvRowToInput(header, row, i + 2, categoryMap);
        errors.push(...rowErrors);
        if (input && rowErrors.length === 0) {
          try {
            validateQuestionOrThrow(input);
            inputs.push(input);
          } catch (err) {
            const details = (err as { details?: { errors?: string[] } }).details;
            for (const e of details?.errors ?? [(err as Error).message]) errors.push({ row: i + 2, field: 'content', error: e });
          }
        }
      });
    }

    if (errors.length > 0 && mode === 'strict') {
      return { imported: 0, skipped: inputs.length, errors: errors.slice(0, 200), totalErrors: errors.length };
    }

    let imported = 0;
    let duplicates = 0;
    for (const input of inputs) {
      const hash = computeContentHash(input.type, input.content, input.correctAnswer);
      const dupe = await query(`SELECT 1 FROM questions WHERE content_hash = $1 AND status <> 'archived' LIMIT 1`, [hash]);
      if (dupe.rowCount) {
        duplicates++;
        continue;
      }
      const { rows } = await query(
        `INSERT INTO questions (type, category_id, subcategory_id, difficulty, language, content, correct_answer,
           configuration, points, time_limit_sec, explanation, tags, source, source_url, source_reference,
           status, content_hash, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
        [
          input.type, input.categoryId ?? null, input.subcategoryId ?? null, input.difficulty, input.language,
          JSON.stringify(input.content), JSON.stringify(input.correctAnswer ?? null), JSON.stringify(input.configuration),
          input.points ?? 10, input.timeLimitSec ?? null, JSON.stringify(input.explanation), input.tags,
          input.source, input.sourceUrl, input.sourceReference, status, hash, req.userId,
        ],
      );
      await query('INSERT INTO question_stats (question_id) VALUES ($1) ON CONFLICT DO NOTHING', [rows[0].id]);
      imported++;
    }
    audit(req.userId, 'question.imported', 'question', '', { imported, duplicates, errors: errors.length });
    return { imported, duplicates, errors: errors.slice(0, 200), totalErrors: errors.length };
  });

  /** Export filtered questions as JSON or CSV (Excel-compatible UTF-8 CSV). */
  app.get('/export', { preHandler: [editor] }, async (req, reply) => {
    const q = req.query as Record<string, string>;
    const format = q.format === 'csv' ? 'csv' : 'json';
    const params: unknown[] = [];
    const where: string[] = ['1=1'];
    const add = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };
    if (q.status) where.push(`q.status = ${add(q.status)}`);
    if (q.categoryId) where.push(`q.category_id = ${add(q.categoryId)}`);
    if (q.difficulty) where.push(`q.difficulty = ${add(q.difficulty)}`);
    if (q.language) where.push(`q.language = ${add(q.language)}`);
    if (q.type) where.push(`q.type = ${add(q.type)}`);
    const limit = Math.min(Number(q.limit ?? 10000), 50000);
    const { rows } = await query(
      `SELECT q.*, c.slug AS category_slug FROM questions q
       LEFT JOIN categories c ON c.id = q.category_id
       WHERE ${where.join(' AND ')} ORDER BY q.created_at LIMIT ${add(limit)}`,
      params,
    );
    audit(req.userId, 'question.exported', 'question', '', { count: rows.length, format });

    if (format === 'json') {
      reply.header('content-disposition', 'attachment; filename="questions.json"');
      return rows.map((r) => ({
        type: r.type,
        categorySlug: r.category_slug,
        difficulty: r.difficulty,
        language: r.language,
        content: r.content,
        correctAnswer: r.correct_answer,
        configuration: r.configuration,
        points: r.points,
        timeLimitSec: r.time_limit_sec,
        explanation: r.explanation,
        tags: r.tags,
        source: r.source,
        sourceUrl: r.source_url,
        status: r.status,
      }));
    }
    const csvRows: unknown[][] = [CSV_COLUMNS as unknown as unknown[]];
    for (const r of rows) {
      const content = r.content as Record<string, unknown>;
      const prompt = (content.prompt ?? {}) as Record<string, string>;
      csvRows.push([
        r.type, r.category_slug ?? '', r.difficulty, r.language,
        typeof content.prompt === 'string' ? content.prompt : prompt.en ?? '',
        typeof content.prompt === 'string' ? '' : prompt.ar ?? '',
        content.options ? JSON.stringify(content.options) : '',
        JSON.stringify(r.correct_answer), r.points, r.time_limit_sec ?? '',
        (r.explanation as Record<string, string>)?.en ?? '', (r.explanation as Record<string, string>)?.ar ?? '',
        (r.tags as string[]).join('|'), r.source, r.source_url,
      ]);
    }
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="questions.csv"');
    return reply.send(toCsv(csvRows));
  });
}
