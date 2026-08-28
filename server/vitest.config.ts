import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    env: { NODE_ENV: 'test' },
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }, // shared test DB — run serially
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
