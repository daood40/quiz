# Deployment

## One-command options (pick one)

| Target | How |
|---|---|
| **Docker (any VPS)** | `docker compose up -d --build` — API + SPA + PostgreSQL 16 from `docker-compose.yml`; set `JWT_SECRET`, `POSTGRES_PASSWORD`, `CORS_ORIGIN` in `.env` |
| **Render** | New → Blueprint → this repo; `render.yaml` provisions the web service (Docker) + managed Postgres and generates `JWT_SECRET` |
| **Fly.io** | `fly launch --no-deploy` → `fly postgres create && fly postgres attach` → `fly secrets set JWT_SECRET=$(openssl rand -hex 64) CORS_ORIGIN=https://<app>.fly.dev` → `fly deploy` (uses `fly.toml` + `Dockerfile`) |
| **Railway** | New project → Deploy from GitHub (Dockerfile auto-detected) → add PostgreSQL plugin → set `JWT_SECRET`, `CORS_ORIGIN`; `DATABASE_URL` is injected |

| **Prebuilt image** | `docker run -p 3001:3001 -e DATABASE_URL=postgres://… -e JWT_SECRET=$(openssl rand -hex 64) -e SEED_ON_BOOT=true ghcr.io/daood40/quiz:latest` — published by `.github/workflows/docker.yml` on every push (`latest`) and tag (`vX.Y.Z`), smoke-run against PostgreSQL in CI |

**First boot is automatic.** With `SEED_ON_BOOT=true` (already set in the
compose file, Render blueprint and Fly config) the API runs migrations, then
creates the super admin (`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`; a random
password is printed to the log if unset), the core categories and
achievements, and the 154-question starter bank (EN + AR). Everything is
idempotent, so the flag can stay on. Set `SEED_QUESTIONS=false` to skip the
starter bank when importing your own. Log in and change the admin password.
Health check: `GET /health`.

**Point the GitHub Pages site at the live API** by adding one repository
variable (Settings → Secrets and variables → Actions → Variables):
`VITE_API_BASE = https://<api-host>/api/v1`. The next Pages deploy builds the
full app instead of the demo. Add `https://daood40.github.io` to the API's
`CORS_ORIGIN`. Or simply use the SPA the API serves itself (default).

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
1. `SEED_ON_BOOT=true` (or `npm run seed` once) with `SEED_ADMIN_EMAIL` /
   `SEED_ADMIN_PASSWORD` set → super admin + core categories/achievements +
   the starter question bank (`SEED_QUESTIONS=false` to skip it).
2. Log in as the admin, change the password, review Settings, import your
   own question bank (Admin → Import), approve questions.

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
