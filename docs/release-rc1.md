# BeezMovies RC1

Release label: `BeezMovies RC1`. Package version: `1.0.0-rc.1`.

The label is returned by `GET /api/v1/admin/system` and shown on the admin System page. Public health, movie pages, and the homepage do not include it.

This document prepares deployment planning. It does not deploy the application.

## Phase 12 classification

Must fix before release: none. The Phase 12 audit found no critical or high defects.

Safe to release, with the production settings in this document:

- Anonymous browse, search, movie pages, and authorized download.
- Server-side roles, parameterized SQL, restrictive CORS, and local HSTS disabled.
- Optional Redis. Public catalog continues when cache is down.
- Download resolution uses stored provider references, not caller-supplied URLs.
- Ads stay collapsed unless a provider is enabled, ready, and has a creative.

Post-release improvement:

- Production page CSP still allows `'unsafe-inline'` scripts because Next.js has no nonce pipeline here.
- Sitemap lists published movies and four static routes, not every genre or collection URL.
- Next.js 16 warns that `middleware.js` should move to the proxy convention. The admin redirect still works.
- Initialize Git before the first commit so `.gitignore` actually excludes `.env`.

## Reproduce the local build

From the repository root, with Node.js 20+ and PostgreSQL 16+ already running:

```bash
npm install --prefix backend
npm install --prefix frontend
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env.local
```

Create the local role and database once:

```sql
CREATE ROLE beezmovies LOGIN PASSWORD 'beezmovies_local';
CREATE DATABASE beezmovies OWNER beezmovies;
```

`beezmovies_local` is a development fixture. Do not use it in production.

```bash
npm run migrate
npm run seed
npm run verify:database
npm test
npm run build --prefix frontend
npm run dev:backend
npm run dev:frontend
npm run worker
```

Open http://localhost:3000. The API is http://localhost:5000/api/v1.

`npm run seed` applies migrations, loads `database/seeds/001_catalog_dev.sql`, and upserts `admin@beezmovies.local` / `BeezLocalAdmin1`. It refuses to run when `NODE_ENV=production`. The seed is public-domain catalog text and `example.com` references. It does not contain provider tokens or video files.

`npm run verify:database` creates schema `beezmovies_rc_verify` inside the local `beezmovies` database, migrates, seeds, checks health, readiness, and the movie list, runs migrations a second time, then drops only that schema. The local role cannot create a second database. The script exits unless `DATABASE_URL` names `beezmovies`, and it aborts if the public catalog fingerprint changes.

Migrations `001_foundation.sql` through `011_monetization.sql` run in filename order, each in a transaction, and are recorded in `schema_migrations`. A second run applies nothing. Migration `009` creates the development media provider only. The Nosferatu download reference is seed data, because a migration must not require a movie row that does not exist on an empty database.

## Environment

Backend variables: `NODE_ENV`, `PORT`, `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGIN`, `LOG_LEVEL`, `BODY_LIMIT`, `PG_POOL_MAX`, `MEDIA_PROVIDERS`, `MEDIA_HANDOFF_SECRET`.

Frontend variables: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`.

Development uses the local database, `development-media`, and `beezmovies-local-handoff`. Test uses `NODE_ENV=test` against that same local database and disables rate limiters. Production must set its own database URL, CORS origin, and handoff secret. An empty `MEDIA_HANDOFF_SECRET` in production fails downloads closed. The frontend must not receive database URLs or handoff secrets.

## API contract

Success bodies use `{ data }` or `{ data, pagination }`. Errors use `{ error: { code, message } }` and do not include SQL or stack traces when `NODE_ENV=production`.

Unsafe browser methods require `x-beezmovies-request: 1`. Authenticated routes use the `beezmovies_session` cookie.

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | Public | Process liveness. No database call. |
| `GET /ready` | Public | Postgres required. Redis reported and optional. |
| `POST /auth/register`, `/auth/login`, `/auth/logout` | Public, login rate-limited | Account session. |
| `POST /auth/password/forgot`, `/auth/password/reset` | Public | Reset architecture. |
| `GET /auth/me` | User | Current account. |
| `GET /movies`, `/movies/:slug` | Public | Catalog. |
| `POST /movies/:slug/download` | Public, empty body, rate-limited | Authorized resolution. |
| `GET /media/handoff/:token` | Public, signed token | Same-origin local handoff. |
| `GET /search`, `/search/suggestions` | Public | Derived search index. |
| `GET /discovery/trending`, `/popular`, `/recent`, `/genres`, `/collections` | Public | Homepage rails. |
| `GET /genres`, `/genres/:slug/movies`, `/collections`, `/collections/:slug` | Public | Browse. |
| `GET /monetization/config` | Public | Collapsed placements when ads are off. |
| `GET /admin/system` and other `/admin/*` | Admin, plus a permission on writes | Control plane. |

`GET /movies/id/:id` is an authenticated admin lookup. Public identity is the slug.

## Performance budget

Measured on Windows 10, Node 24, local PostgreSQL, Redis unavailable. These are local budgets, not cluster capacity.

| Surface | Budget | Phase 12 observation |
| --- | --- | --- |
| Movie list API p95 | under 100 ms | 9 ms |
| Movie detail API p95 | under 250 ms | 97 ms |
| Search API p95 | under 100 ms | 4 ms |
| Catalog SQL on the seed | under 5 ms | under 1 ms |
| Initial public JavaScript | no extra client framework beyond Next.js | production build completed |

The homepage HTML sample on the Next development server was about 1.3–2.0 seconds because that server compiles on demand. Re-measure with `npm run start:frontend` before a launch. Do not treat the development-server time as a production regression.

## Backup and recovery

Production PostgreSQL needs a scheduled logical backup. Take `pg_dump --format=custom` of the application database daily, keep 30 daily copies and 12 monthly copies, and store them outside the database host. Do not back up by copying the live data directory while Postgres is writing.

Restore drill, on a spare database, not on the live one:

```bash
pg_restore --clean --if-exists --dbname beezmovies_restore beezmovies.dump
```

Then run `npm run migrate` so any migration newer than the dump is applied, and call `GET /api/v1/ready`. Confirm a known movie slug, an admin login, and one download resolution. A restore is verified only when those three succeed. This repository does not run that drill against production.

Redis holds derived cache only. Losing it does not require a restore. Search documents are rebuilt from PostgreSQL with the admin reindex job.

## Content and providers

Catalog rows and media references may be stored only when BeezMovies is allowed to index, link, stream, or distribute that material. The development seed uses public-domain titles and example references. The application server does not store movie video binaries. Resolution accepts a movie slug, loads an enabled provider reference, and rejects an empty or non-empty caller URL. Do not add an open proxy.

| Dependency | State |
| --- | --- |
| PostgreSQL | Configured locally. Required. |
| Redis | Not configured on this machine. Optional. |
| `development-media` | Configured for local text handoffs. Not a public video source. |
| Metadata ingestion source | Local development adapter only. |
| ExoClick, HilltopAds, InfoLinks, Adsterra, PropellerAds | Not configured. Credentials and terms review required before any use. |
| Rapidgator, Katfile, Doodstream | Not configured. Documentation and legal review required. |
| House ads | Present, disabled. No third-party script. |
| Analytics | Not configured. |
| Object storage for video | Not used. Do not add it for movie binaries. |
| Argon2, Express, Next.js, PostgreSQL driver | Application dependencies. No provider credentials. |

## Observability

Each request gets `X-Request-Id`. Logs use pino and pass messages through the sanitizer, which redacts database URLs and assignments that look like passwords, secrets, or tokens. Do not log session cookies, handoff tokens, or provider credentials.

`GET /health` means the process is alive. `GET /ready` means Postgres accepted the foundation check. Worker idleness is visible on the admin dashboard, not on the public readiness probe, so a stopped worker does not take the site down.

## Failure behavior

| Failure | Expected result |
| --- | --- |
| Database closed | `/health` stays 200. `/ready` returns 503 with `postgres: unavailable`. |
| Redis down | `/ready` stays 200. Cache status is unavailable. |
| Unknown movie | 404 JSON error. |
| Download body containing a URL | 400. The URL is not fetched. |
| Malformed or expired handoff | 4xx `MEDIA_EXPIRED`. |
| Title with no download reference | Clean client error. The page stays usable. |
| Search engine or index error | Safe error body. Catalog pages still read PostgreSQL. |
| Worker stopped | Browse and download keep working. Ingestion and reindex wait. |
| Ad provider disabled or failing | Placements stay empty. Download does not import ads. |
| Missing artwork | The card shows the unavailable state. |
| Oversized JSON | 413. |
