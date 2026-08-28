import { buildApp } from './app.js';
import { env } from './config/env.js';
import { closePool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { startJobs, stopJobs } from './jobs/scheduler.js';

async function main(): Promise<void> {
  await migrate();
  const app = await buildApp();
  if (env.jobsEnabled) startJobs();

  await app.listen({ port: env.port, host: env.host });
  app.log.info(`QUIZ PLATFORM API listening on ${env.host}:${env.port}`);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} received — shutting down`);
    stopJobs();
    await app.close();
    await closePool();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
