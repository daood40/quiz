import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import { query } from '../src/db/pool.js';
import { closeAll, getApp } from './helpers.js';

beforeAll(async () => { await getApp(); });
afterAll(async () => { await closeAll(); });

describe('migrations', () => {
  it('are idempotent: a second run applies nothing and every row carries a checksum', async () => {
    const again = await migrate();
    expect(again).toEqual([]);
    const { rows } = await query<{ name: string; checksum: string | null }>('SELECT name, checksum FROM schema_migrations ORDER BY name');
    expect(rows.length).toBeGreaterThanOrEqual(6);
    expect(rows.every((r) => typeof r.checksum === 'string' && r.checksum.length === 64)).toBe(true);
  });

  it('refuse to run when an applied migration file was edited (drift detection)', async () => {
    await query(`UPDATE schema_migrations SET checksum = 'tampered' WHERE name = '001_initial_schema.sql'`);
    await expect(migrate()).rejects.toThrow(/modified after being applied/);
    // restore the real checksum so later suites are unaffected
    await query(`UPDATE schema_migrations SET checksum = NULL WHERE name = '001_initial_schema.sql'`);
    await migrate();
    const { rows } = await query(`SELECT checksum FROM schema_migrations WHERE name = '001_initial_schema.sql'`);
    expect(rows[0].checksum).toHaveLength(64);
  });
});
