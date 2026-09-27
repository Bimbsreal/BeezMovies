# BeezMovies staging

Staging is not running. No staging host, database, TLS certificate, or secret store was configured in this phase. The development servers on ports 3000 and 5000 are not a staging deployment.

Placeholder names, not DNS records:

- Site: `https://staging.beezmovies.example`
- API: `https://api.staging.beezmovies.example/api/v1`

Do not point staging at the local `beezmovies` database or at any production database. Do not reuse `beezmovies_local` or `beezmovies-local-handoff`.

## Architecture

```
staging edge (TLS, not configured)
  ├─ next start          NEXT_PUBLIC_SITE_ENV=staging
  └─ node backend/src/index.js    NODE_ENV=production
        ├─ PostgreSQL beezmovies_staging
        ├─ Redis optional, separate from production
        └─ node workers/src/bootstrap.js
API → development-media or another authorized test reference → browser
```

Movie binaries stay at the provider. Real ad networks and affiliate credentials stay off.

## What is missing

| Requirement | State |
| --- | --- |
| Staging PostgreSQL `beezmovies_staging` with its own login | Not created. The local login cannot create databases. |
| Staging password distinct from development | Not issued. |
| Redis with its own password | Not installed. |
| Reverse proxy and TLS certificate | Not configured. |
| DNS for `staging.beezmovies.example` | Not configured. Intentionally. |
| Production-mode API and `next start` on the staging network | Not started. |
| Worker process against the staging database | Not started. |
| Backup restored into a second database | Not run. |
| PWA install on a staging origin | Not run. The install dialog needs the staging origin. |

## Environment variables

Copy the examples and replace every `CHANGE_ME` in the secret store. Do not commit the copies. `.env.staging` is gitignored once Git exists. This workspace is still not a Git repository.

Backend, `backend/.env.staging.example`:

`NODE_ENV`, `PORT`, `LOG_SERVICE`, `DATABASE_URL`, `REDIS_URL`, `CORS_ORIGIN`, `LOG_LEVEL`, `BODY_LIMIT`, `PG_POOL_MAX`, `MEDIA_PROVIDERS`, `MEDIA_HANDOFF_SECRET`.

`DATABASE_URL` must name `beezmovies_staging` and use `sslmode=verify-full` on a hosted database. `MEDIA_HANDOFF_SECRET` is required because `NODE_ENV=production` has no local fallback.

Frontend, `frontend/.env.staging.example`. These three are public:

`NEXT_PUBLIC_SITE_ENV=staging`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`.

`NEXT_PUBLIC_SITE_ENV=staging` makes `robots.txt` disallow all crawling, omits the sitemap, sets page robots to noindex, and sends `X-Robots-Tag: noindex, nofollow`. Production sets `NEXT_PUBLIC_SITE_ENV=production` and keeps the public indexing rules. Development leaves the variable unset.

There is no analytics provider. Leave it unset. `MEDIA_PROVIDERS=development-media` is the authorized local test adapter. Do not put provider tokens in the frontend.

## Procedure when the host exists

Run these only after the staging database and secret store exist. They were not run here.

```bash
npm install --prefix backend
npm install --prefix frontend
```

Load `backend/.env.staging` into the process environment. It must not be the development `.env`.

```bash
npm run migrate --prefix backend
```

Set `BEEZ_SEED_TARGET=staging` and point `DATABASE_URL` at `beezmovies_staging`, then run `npm run seed:staging`. That command loads the public-domain catalog text and does not create `admin@beezmovies.local`. `npm run seed` refuses both staging and production database names. `npm run seed:production` always refuses. Do not point either command at production.

Start processes with the staging environment, not `npm run dev`:

```bash
node backend/src/index.js
node workers/src/bootstrap.js
```

Build the frontend with the staging public variables and without relying on `frontend/.env.local`:

```bash
npm run build --prefix frontend
npm run start --prefix frontend
```

`next start` is the staging runtime. `next dev` is not.

Health: `GET /api/v1/health` returns process liveness. `GET /api/v1/ready` must report postgres `ok`. Redis may be unavailable. Logs use `service` `beezmovies-api` or `beezmovies-worker`, a request id, method, redacted route, status, and duration. The sanitizer removes database URLs and token assignments.

## Smoke tests

After a real staging process is up:

1. Homepage, search, and a movie page return 200 without a login.
2. Download resolves a test reference and rejects a caller-supplied URL.
3. `robots.txt` disallows `/`.
4. Manifest is standalone. An installed launch plays the bee once. Later navigations do not.
5. Admin login reaches System and shows `BeezMovies RC1`. Anonymous `/api/v1/admin/system` returns 401.
6. Provider health, ingestion of a test record, and search reindex succeed. Public search still answers during reindex.
7. Stopping the worker leaves `/ready` ok. Stopping Redis leaves the catalog readable.

Phone, tablet, and desktop checks wait on that origin. They were not run against a staging URL.

## Backup and restore

When `beezmovies_staging` exists:

```bash
pg_dump --format=custom --file=beezmovies_staging.dump --dbname=beezmovies_staging
pg_restore --clean --if-exists --dbname=beezmovies_staging_restore beezmovies_staging.dump
```

Then compare schema, a movie row, a foreign key, and an index against the source. Drop the restore database afterward. This drill was not executed.

## Rollback

Stop the staging frontend, API, and worker. Start the previous build with the same staging database. Do not run a down migration. Do not point the rollback at the development or production database.

## Known issues

- Staging acceptance is blocked until the missing infrastructure table is filled.
- The local database role cannot `CREATE DATABASE`.
- MFA is not implemented.
- Production page CSP still allows inline scripts.
- Git is not initialized, so ignore rules are not enforced yet.
- A restore drill has never succeeded.
