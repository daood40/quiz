import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool.js';

/** Prometheus registry: process defaults + RED metrics + DB pool gauges + job outcomes. */
export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'HTTP requests by method, route and status',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});
export const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency',
  labelNames: ['method', 'route'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});
export const rateLimited = new Counter({
  name: 'rate_limited_total',
  help: 'Requests rejected by a rate limiter',
  labelNames: ['limiter'] as const,
  registers: [registry],
});
export const jobRuns = new Counter({
  name: 'job_runs_total',
  help: 'Background job outcomes',
  labelNames: ['job', 'status'] as const,
  registers: [registry],
});
export const errors5xx = new Counter({
  name: 'http_5xx_total',
  help: 'Unhandled server errors',
  registers: [registry],
});

export function registerMetrics(app: FastifyInstance): void {
  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions?.url ?? 'unmatched';
    const labels = { method: req.method, route };
    httpRequests.inc({ ...labels, status: String(reply.statusCode) });
    httpDuration.observe(labels, reply.elapsedTime / 1000);
  });
  // scrape endpoint: protect at the network edge (or set METRICS_TOKEN) — never public
  app.get('/metrics', async (req, reply) => {
    const token = process.env.METRICS_TOKEN;
    if (token && req.headers.authorization !== `Bearer ${token}`) {
      reply.status(401);
      return { error: { code: 'unauthorized', message: 'metrics token required' } };
    }
    registry.setDefaultLabels({});
    const poolGauge = `# HELP db_pool_connections PostgreSQL pool state\n# TYPE db_pool_connections gauge\n` +
      `db_pool_connections{state="total"} ${pool.totalCount}\n` +
      `db_pool_connections{state="idle"} ${pool.idleCount}\n` +
      `db_pool_connections{state="waiting"} ${pool.waitingCount}\n`;
    reply.header('content-type', registry.contentType);
    return (await registry.metrics()) + poolGauge;
  });
}
