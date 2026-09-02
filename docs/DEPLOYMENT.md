# Deployment

## One-command options (pick one)

| Target | How |
|---|---|
| **Docker (any VPS)** | `docker compose up -d --build` — API + SPA + PostgreSQL 16 from `docker-compose.yml`; set `JWT_SECRET`, `POSTGRES_PASSWORD`, `CORS_ORIGIN` in `.env` |
| **Render** | New → Blueprint → this repo; `render.yaml` provisions the web service (Docker) + managed Postgres and generates `JWT_SECRET` |
| **Fly.io** | `fly launch --no-deploy` → `fly postgres create && fly postgres attach` → `fly secrets set JWT_SECRET=$(openssl rand -hex 64) CORS_ORIGIN=https://<app>.fly.dev` → `fly deploy` (uses `fly.toml` + `Dockerfile`) |
| **Railway** | New project → Deploy from GitHub (Dockerfile auto-detected) → add PostgreSQL plugin → set `JWT_SECRET`, `CORS_ORIGIN`; `DATABASE_URL` is injected |

After first boot run the seed once (`docker compose exec api node server/dist/db/seed.js`
or the platform's shell) with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` set,
then log in and change the admin password. Health check: `GET /health`.

Point the GitHub Pages demo at the live API by setting `VITE_API_BASE`
(e.g. `https://<api-host>/api/v1`) and dropping `VITE_DEMO` in
`.github/workflows/pages.yml` — or serve the SPA from the API itself (default).

## Single-server (simplest production)

```bash
npm ci
npm run build                              # server → dist/, web → dist/
export NODE_ENV=production
export DATABASE_URL=postgres://…           # managed PostgreSQL 16 recommended
export JWT_SECRET=$(openssl rand -hex 64)
export CORS_ORIGIN=https://your-domain
node server/dist/index.js                  # runs migrations, serves API + SPA
```

Run under a process manager (systemd / PM2 / container). Put a TLS
terminator (nginx/Caddy/ALB) in front. Health check: `GET /health`.

### Container sketch
```Dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY . .
RUN npm ci && npm run build
FROM node:22-slim
WORKDIR /app
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/src/db/migrations server/dist/db/migrations
COPY --from=build /app/web/dist web/dist
COPY --from=build /app/node_modules node_modules
COPY package.json server/package.json ./
EXPOSE 3001
CMD ["node", "server/dist/index.js"]
```

## First boot
1. `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` set → `npm run seed` creates
   the super admin + core categories/achievements (production skips sample
   questions unless `SEED_DEV=true`).
2. Log in as the admin, change the password, review Settings, import your
   question bank (Admin → Import), approve questions.

## Scaling out
- **Multiple API instances:** stateless by design (JWT + DB). First swap the
  in-memory rate limiter for Redis (same interface in `core/rateLimit.ts`),
  and set `JOBS_ENABLED=true` on exactly one instance (or move
  `jobs/scheduler.ts` functions into a dedicated worker/cron).
- **Database:** managed PostgreSQL with PITR; add read replicas for
  stats/analytics endpoints; partition high-volume tables per
  docs/DATABASE.md.
- **Media:** store question media in object storage (S3/GCS) behind a CDN;
  the question model already references media by URL — never store blobs in
  the database.

## CI/CD
GitHub Actions workflow (`.github/workflows/ci.yml`): typecheck server +
web, run the full test suite against a PostgreSQL service container, build
both artifacts, and `npm audit --omit=dev` as a security gate. Deploy only
on green.

## Backups / rollback
See docs/DATABASE.md. App rollback: keep the previous build artifact;
migrations are forward-only and additive within a release, so the previous
app version keeps running against the migrated schema; data-damaging
mistakes use PITR.
