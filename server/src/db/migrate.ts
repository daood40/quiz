import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, closePool } from './pool.js';

const MIGRATION_LOCK_KEY = 7_412_009;
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Applies pending SQL migrations in filename order, each in its own transaction. */
export async function migrate(): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id serial PRIMARY KEY,
      name text UNIQUE NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
  await pool.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text');

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const ran: string[] = [];
  // one migrator at a time across all instances (rolling deploys, autoscaling)
  const lockClient = await pool.connect();
  try {
  await lockClient.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
  const { rows } = await pool.query<{ name: string; checksum: string | null }>('SELECT name, checksum FROM schema_migrations');
  const applied = new Map(rows.map((r) => [r.name, r.checksum]));

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    if (applied.has(file)) {
      // drift detection: an applied migration file must never change; record the checksum for legacy rows
      const known = applied.get(file);
      if (known === null || known === undefined) await pool.query('UPDATE schema_migrations SET checksum = $2 WHERE name = $1', [file, checksum]);
      else if (known !== checksum) throw new Error(`Migration ${file} was modified after being applied (checksum mismatch); create a new migration instead`);
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file, checksum]);
      await client.query('COMMIT');
      ran.push(file);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
    } finally {
      client.release();
    }
  }
  } finally {
    await lockClient.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    lockClient.release();
  }
  return ran;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  migrate()
    .then((ran) => {
      console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'No pending migrations');
      return closePool();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
