import { query } from '../db/pool.js';
import { log } from './log.js';

/** Fire-and-forget audit logging — never breaks the request path. */
export function audit(
  actorId: string | null,
  action: string,
  entity = '',
  entityId = '',
  details: Record<string, unknown> = {},
  ip = '',
): void {
  query(
    `INSERT INTO audit_logs (actor_id, action, entity, entity_id, details, ip)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [actorId, action, entity, entityId, JSON.stringify(details), ip],
  ).catch((err) => log.error({ err }, 'audit log write failed'));
}

export function trackEvent(userId: string | null, kind: string, properties: Record<string, unknown> = {}): void {
  query(`INSERT INTO analytics_events (user_id, kind, properties) VALUES ($1, $2, $3)`, [
    userId,
    kind,
    JSON.stringify(properties),
  ]).catch((err) => log.error({ err }, 'analytics event write failed'));
}
