import { buildApp } from './app.js';
import { env } from './config/env.js';
import { closePool } from './db/pool.js';
import { initAlerts, reportError } from './core/alerts.js';
import { log } from './core/log.js';
import { migrate } from './db/migrate.js';
import { seed } from './db/seed.js';
import { startJobs, stopJobs } from './jobs/scheduler.js';

async function main(): Promise<void> {
  await initAlerts(env.isProd ? 'production' : 'development');
  await migrate();
  // one-click hosting: SEED_ON_BOOT=true creates the admin + categories + starter bank (idempotent)
  if (process.env.SEED_ON_BOOT === 'true') await seed();
  const app = await buildApp();
  if (env.jobsEnabled) startJobs();

  await app.listen({ port: env.port, host: env.host });
  app.log.info(`QUIZ PLATFORM API listening on ${env.host}:${env.port}`);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} received — shutting down`);
    stopJobs();
    // drain in-flight requests, but never hang past the platform's kill window
    const deadline = new Promise<void>((resolve) => setTimeout(resolve, 15_000).unref());
    await Promise.race([app.close().then(() => closePool()), deadline]);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  log.fatal({ err }, 'fatal startup error');
  reportError(err, { kind: 'startup' });
  process.exit(1);
});
