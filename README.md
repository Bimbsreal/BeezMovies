# BeezMovies

Release candidate **BeezMovies RC1** (`1.0.0-rc.1`). This workspace is the local application: Next.js PWA, API, catalog, authentication, search, authorized media resolution, admin, and a provider-agnostic ad layer. It is not deployed.

The release checklist, environment profiles, backup plan, and content rules are in [docs/release-rc1.md](docs/release-rc1.md). The production topology is in [docs/production-deployment.md](docs/production-deployment.md). The operator procedures and release checklist are in [docs/production-runbook.md](docs/production-runbook.md). Day-to-day monitoring and incidents are in [docs/operations.md](docs/operations.md). Catalog bootstrap is in [docs/production-catalog-seeding.md](docs/production-catalog-seeding.md). The changelog is [CHANGELOG.md](CHANGELOG.md). The production architecture and readiness checklist are in [docs/production-architecture.md](docs/production-architecture.md). Staging is not deployed. The staging checklist is in [docs/staging-deployment.md](docs/staging-deployment.md). Incident handling is in [docs/incident-response.md](docs/incident-response.md). Catalog quality, review, and merge rules are in [docs/catalog-operations.md](docs/catalog-operations.md). Automated metadata ingestion is in [docs/catalog-ingestion.md](docs/catalog-ingestion.md).

## Architecture

```
frontend/        Next.js application, PWA, and brand shell
backend/         Express REST API under /api/v1
database/        SQL migrations
workers/         Background worker process
infrastructure/  Local Docker Compose for machines that need it
docs/            System boundaries
```

The browser talks only to the Next.js app. The API is a separate Node process. PostgreSQL is required for readiness. Redis is optional: the API and worker start when Redis is unset or unreachable.

Details: [docs/architecture.md](docs/architecture.md).

## Prerequisites

- Node.js 20 or newer
- PostgreSQL 16 or newer
- Redis, only when you want the optional cache/queue connection

Docker is not required. `infrastructure/docker-compose.yml` is a local-only alternative for machines without PostgreSQL or Redis installed.

## Environment

Copy the examples and keep real values out of git:

```bash
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env.local
```

On macOS or Linux, use `cp` instead of `copy`.

| Variable | Where | Purpose |
| --- | --- | --- |
| `PORT` | backend | API port. Local default `5000`. |
| `DATABASE_URL` | backend | PostgreSQL connection string. Required. |
| `REDIS_URL` | backend | Optional Redis connection string. |
| `CORS_ORIGIN` | backend | Allowed browser origin. Local default `http://localhost:3000`. |
| `LOG_LEVEL` | backend | Pino level. |
| `BODY_LIMIT` | backend | JSON body limit. Default `1mb`. |
| `PG_POOL_MAX` | backend | PostgreSQL pool size. Default `10`. |
| `MEDIA_PROVIDERS` | backend | Enabled media adapter slugs. Local default `development-media`. |
| `MEDIA_HANDOFF_SECRET` | backend | HMAC secret for same-origin download handoffs. Production must set a unique value. |
| `NEXT_PUBLIC_API_URL` | frontend | API base URL, `http://localhost:5000/api/v1`. |
| `NEXT_PUBLIC_SITE_URL` | frontend | Public site URL used for metadata. |

Development, test, and production profiles are commented in the example files. Production must not reuse `beezmovies_local` or `beezmovies-local-handoff`.

`backend/.env.example` uses the local role `beezmovies` / `beezmovies_local`. That password is for this development database only.

## PostgreSQL

PostgreSQL must be running locally. Create the role and database:

```sql
CREATE ROLE beezmovies LOGIN PASSWORD 'beezmovies_local';
CREATE DATABASE beezmovies OWNER beezmovies;
```

Apply migrations from the repository root:

```bash
npm install --prefix backend
npm run migrate
```

Confirm migrations on a throwaway schema named `beezmovies_rc_verify`. The local role cannot create a second database. This command does not drop the development database or the `public` schema:

```bash
npm run verify:database
```

Migrations live in `database/migrations` and are applied in filename order inside a transaction. The runner records them in `schema_migrations`.

Development catalog examples are not part of migrations. Load them only on a local database:

```bash
npm run seed
```

`npm run seed` applies migrations first, then `database/seeds`. It refuses to run when `NODE_ENV=production`. The catalog model is described in [docs/catalog-schema.md](docs/catalog-schema.md). The same command upserts a local admin, `admin@beezmovies.local` / `BeezLocalAdmin1`. That password is a development fixture. Authentication behavior is described in [docs/auth.md](docs/auth.md). The catalog read API is described in [docs/catalog-api.md](docs/catalog-api.md). Search and discovery are described in [docs/search.md](docs/search.md). The public movie pages are described in [docs/public-experience.md](docs/public-experience.md). Download resolution is described in [docs/media-providers.md](docs/media-providers.md). Trailers and playback are described in [docs/media-experience.md](docs/media-experience.md). Homepage rails are described in [docs/recommendation-engine.md](docs/recommendation-engine.md). The admin control center is described in [docs/admin-cms.md](docs/admin-cms.md). Product analytics are described in [docs/analytics.md](docs/analytics.md).

## Redis

Redis is not required to boot the API, run migrations, or open the shell.

When `REDIS_URL` is set and Redis is reachable, the API connects at startup. When it is unset or unreachable, startup continues and `GET /api/v1/ready` reports Redis as not required.

Local Redis, if you install it, should listen on `127.0.0.1:6379`. The worker process uses the same variable:

```bash
npm run worker
```

`workers/src/index.js` registers the metadata ingestion cycle and the search index cycle. Both poll PostgreSQL, so the worker still runs when Redis is unreachable.

## Run locally

Install once:

```bash
npm install --prefix backend
npm install --prefix frontend
```

Start the API:

```bash
npm run dev:backend
```

Start the frontend:

```bash
npm run dev:frontend
```

## Tests

```bash
npm test
```

Backend tests call the real local database for readiness, the catalog constraints, and authentication. Frontend tests check the official logo bytes, manifest, startup phases, and service-worker cache rules.

## Local URLs

- App: http://localhost:3000
- API: http://localhost:5000/api/v1
- Health: http://localhost:5000/api/v1/health
- Readiness: http://localhost:5000/api/v1/ready
- Movies: http://localhost:5000/api/v1/movies
- Search: http://localhost:5000/api/v1/search?q=nosferatu
- Search page: http://localhost:3000/search
- Movie example: http://localhost:3000/movie/nosferatu
- Sign in: http://localhost:3000/login
- Register: http://localhost:3000/register
- Manifest: http://localhost:3000/manifest.webmanifest

## Brand

The official logo is `frontend/public/branding/beezmovies-logo.jpg`. Do not redraw or replace it. The header and PWA manifest reference that file. Installed launches play the bee flight from `frontend/lib/startup/phases.js`; a normal browser visit skips it.
