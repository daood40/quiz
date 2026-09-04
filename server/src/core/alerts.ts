import { log } from './log.js';

/**
 * Error tracking / alerting with zero hard dependencies:
 *  - ERROR_WEBHOOK_URL: every unhandled 5xx and failed job is POSTed as JSON (Slack/Discord/Teams/any relay).
 *  - SENTRY_DSN: if @sentry/node is installed (`npm i @sentry/node -w server`), it is loaded dynamically.
 */
type SentryLike = { init(o: { dsn: string; environment?: string; tracesSampleRate?: number }): void; captureException(e: unknown, ctx?: unknown): void };
let sentry: SentryLike | null = null;
let alertBucket = { windowStart: Date.now(), sent: 0 };
const MAX_ALERTS_PER_MINUTE = 20;

export async function initAlerts(environment: string): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    const moduleName = '@sentry/node';
    const mod = (await import(moduleName)) as SentryLike;
    mod.init({ dsn, environment, tracesSampleRate: 0 });
    sentry = mod;
    log.info('sentry error tracking enabled');
  } catch {
    log.warn('SENTRY_DSN set but @sentry/node is not installed: run `npm i @sentry/node -w server`');
  }
}

export function reportError(err: unknown, context: Record<string, unknown> = {}): void {
  sentry?.captureException(err, { extra: context });
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;
  const now = Date.now();
  if (now - alertBucket.windowStart > 60_000) alertBucket = { windowStart: now, sent: 0 };
  if (alertBucket.sent >= MAX_ALERTS_PER_MINUTE) return;
  alertBucket.sent++;
  const e = err as Error;
  const payload = {
    text: `[quiz-platform] ${context.kind ?? 'error'}: ${e?.message ?? String(err)}`,
    error: { name: e?.name, message: e?.message, stack: e?.stack?.split('\n').slice(0, 8).join('\n') },
    context,
    ts: new Date().toISOString(),
  };
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    .catch((sendErr) => log.warn({ err: sendErr }, 'error webhook delivery failed'));
}
