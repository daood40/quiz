import type { FastifyInstance } from 'fastify';
import { query } from '../../db/pool.js';

export async function categoryRoutes(app: FastifyInstance): Promise<void> {
  /** Active category tree with approved-question counts per difficulty. */
  app.get('/', async () => {
    const { rows } = await query(
      `SELECT c.id, c.slug, c.name, c.description, c.parent_id, c.icon, c.color, c.sort_order,
              COALESCE(q.total, 0) AS question_count,
              COALESCE(q.by_difficulty, '{}'::jsonb) AS by_difficulty
       FROM categories c
       LEFT JOIN LATERAL (
         SELECT count(*) AS total,
                jsonb_object_agg(difficulty, cnt) AS by_difficulty
         FROM (
           SELECT difficulty, count(*) AS cnt FROM questions
           WHERE status = 'approved' AND (category_id = c.id OR subcategory_id = c.id)
           GROUP BY difficulty
         ) d
       ) q ON true
       WHERE c.is_active = true
       ORDER BY c.sort_order, c.slug`,
    );
    return {
      categories: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        parentId: r.parent_id,
        icon: r.icon,
        color: r.color,
        sortOrder: r.sort_order,
        questionCount: Number(r.question_count),
        byDifficulty: r.by_difficulty,
      })),
    };
  });
}
