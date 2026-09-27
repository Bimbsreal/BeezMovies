# BeezMovies production deployment

This runbook describes how to deploy BeezMovies later. It does not connect DNS, start production services, or store movie video binaries on the application servers.

Release: BeezMovies RC1 (`1.0.0-rc.1`).

The application server is not media storage. The API resolves a stored provider reference and the browser receives an authorized handoff. Video files stay at the external provider.

```
Internet
  │
  ▼
CDN / TLS edge
  │
  ├──────────────────────┐
  ▼                      ▼
Next.js PWA            API
(private)              (private)
                         │
                    ┌────┴────┐
                    ▼         ▼
               PostgreSQL   Redis (optional)
                    ▲
                    │
                 Worker
                    │
         ┌──────────┼──────────┐
         ▼          ▼          ▼
    Ingestion    Search     Schedule tick

API → media adapter → authorized external provider → browser
```

No hosting vendor is selected. Sizes below are starting categories, not a cloud quote.

## Prerequisites

- Node.js 20 or newer on the frontend, API, and worker.
- PostgreSQL 16 or newer. PostgreSQL 18 matches the machine used for RC1.
- A private network between the API, worker, and database. Redis, if used, stays on that network.
- A TLS certificate for the public names.
- A secret store outside Git.
- `git init` completed and `.gitignore` confirmed before the first commit. `.env` is listed and must stay untracked.
- Unique production values for `DATABASE_URL` and `MEDIA_HANDOFF_SECRET`.
- `NODE_ENV=production` on the API, worker, and frontend.
- Legal authorization for every catalog row and media reference. The development seed is not production content.
- One restore drill on a spare database. That drill has not been run yet.

Do not point staging or production at the local `beezmovies` database. Do not reuse `beezmovies_local` or `beezmovies-local-handoff`.

## Infrastructure

| Piece | Role | Public ports |
| --- | --- | --- |
| CDN / edge | TLS, HTTP to HTTPS, static cache, compression | 443 |
| Reverse proxy | Routes the site and the API to private Node processes | 443 on the edge only |
| Frontend | `next start`, not `next dev` | none |
| API | `node backend/src/index.js` | none |
| Worker | `node workers/src/bootstrap.js` | none |
| PostgreSQL | Catalog, sessions, jobs, search documents | none |
| Redis | Optional cache | none |
| Object storage | Not required for RC1 | none |

Bind Node to a private interface or localhost. The proxy is the only public HTTP entry. Do not publish 3000, 5000, 5432, or 6379.

### Resource categories

| Component | CPU | RAM | Disk | Network | Category |
| --- | --- | --- | --- | --- | --- |
| Frontend | 1 vCPU | 1 GB | 10 GB for the build and OS | moderate page traffic | LOW |
| API | 2 vCPU | 2 GB | 10 GB, logs only | moderate API traffic | LOW |
| Worker | 1 vCPU | 1 GB | 10 GB | light | LOW |
| PostgreSQL | 2 vCPU | 4 GB | 50 GB SSD to start | private only | MEDIUM |
| Redis | 1 vCPU | 1 GB | memory only | private only | LOW |
| CDN / bandwidth | edge | — | — | grows with images and pages, not with video if video stays at the provider | MEDIUM |
| Monitoring | vendor agent | small | log retention | light | LOW |
| External media and ad providers | none on this stack | — | — | provider egress is theirs | HIGH only if a provider bills for resolution volume |

Movie binaries are not in these disks. Raise PostgreSQL disk for catalog growth, not for video.

Process limits: API pool `PG_POOL_MAX` defaults to 10. The worker opens its own pool. Keep `max_connections` at 100 or higher so both pools, migrations, and an admin session fit. Raise the pool only after measuring waiting connections.

Open files: the Node default is enough for this process count. Set the proxy request body limit at 1 MB to match `BODY_LIMIT`.

## Environment variables

Backend, from the secret store:

| Name | Production |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | private listen port, for example `5000` |
| `DATABASE_URL` | `postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=verify-full` |
| `REDIS_URL` | empty to disable, or `rediss://` with a password |
| `CORS_ORIGIN` | `https://beezmovies.example` |
| `LOG_LEVEL` | `info` |
| `BODY_LIMIT` | `1mb` |
| `PG_POOL_MAX` | `10` |
| `MEDIA_PROVIDERS` | slugs of providers that are actually contracted |
| `MEDIA_HANDOFF_SECRET` | unique random secret, required or downloads fail closed |
| `LOG_SERVICE` | optional; the API defaults to `beezmovies-api` |

There is no separate `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, or `DB_SSL`. Those values live only inside `DATABASE_URL`. `sslmode=verify-full` is the production TLS mode when the host presents a certificate chain. The database port stays on the private network.

Frontend, public by design:

| Name | Production |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | `https://api.beezmovies.example/api/v1` |
| `NEXT_PUBLIC_SITE_URL` | `https://beezmovies.example` |

Do not put database URLs, the handoff secret, provider tokens, or ad credentials in frontend variables. They are shipped to the browser.

The worker process sets `LOG_SERVICE=beezmovies-worker` before it loads the logger.

## Secrets inventory

Store these outside Git, logs, screenshots, and docs. Examples below are names only.

| Group | Names | Where |
| --- | --- | --- |
| Database | `DATABASE_URL` | API and worker secret store |
| Auth | session signing is the random session token hashed at rest; cookie name `beezmovies_session` | generated at login, not a static secret |
| Media | `MEDIA_HANDOFF_SECRET`, provider tokens if a future adapter needs them | API and worker only |
| Ads | provider credentials when a network is contracted | API only, still unused |
| Analytics | none configured | — |
| Email | none configured; password reset is local-only until a mailer exists | — |
| Cache | `REDIS_URL` password | API and worker |

## Database

Use a private PostgreSQL 16+ instance. The application reads `DATABASE_URL` at startup and does not embed credentials.

- Enable TLS (`sslmode=verify-full` in the URL).
- One database per environment: `beezmovies` locally, `beezmovies_staging`, `beezmovies_production`.
- One login per environment, not a superuser. Grant that login only its database.
- `max_connections` at least 100. Statement timeout for search is set per query in the application (1.5 seconds). A server-side `statement_timeout` of 30 seconds is a backstop.
- Take a daily `pg_dump --format=custom`. Keep 30 daily and 12 monthly copies off the database host.
- Turn on WAL archiving for point-in-time recovery when the host supports it. Target RPO is 15 minutes with WAL, or 24 hours with dumps only.
- Monitor connections, replication lag if any, disk, and long queries. Alert when connections exceed 80, disk exceeds 80 percent, or the instance stops accepting connections.
- Migrations run from a release checkout: `npm run migrate`. They are forward-only and recorded in `schema_migrations`.

`npm run seed` refuses `NODE_ENV=production` and also refuses database names `beezmovies_staging` and `beezmovies_production`. `npm run seed:production` always refuses. Do not load the development catalog into production.

## Backend

Production command, after `npm install --prefix backend` and with the secret environment loaded:

```bash
node backend/src/index.js
```

Do not use `node --watch`.

`NODE_ENV=production` disables the local handoff fallback, hides `error.debug`, and allows HSTS on the API. Leave HSTS off on any machine that still serves plain HTTP.

On `SIGTERM` or `SIGINT` the API stops accepting connections, waits up to 10 seconds, closes the PostgreSQL pool, and quits Redis. Unhandled rejections are logged and sanitized. An uncaught exception is logged and exits.

HTTP limits on the API process: header timeout 20 seconds, request timeout 30 seconds, keep-alive 5 seconds, JSON body `1mb`. Auth, search, download resolution, and admin writes have their own rate limits. Ordinary catalog reads use the general limiter, which is 100 requests per 15 minutes in production.

`GET /api/v1/health` does not touch the database. `GET /api/v1/ready` checks the foundation row and treats Redis as optional.

## Workers

One worker process, separate from the API:

```bash
node workers/src/bootstrap.js
```

It polls PostgreSQL every 5 seconds:

- metadata ingestion, including a schedule tick at most every 15 minutes;
- search indexing and reindex jobs.

Provider health checks are an admin action (`POST /api/v1/admin/providers/:id/health-check`). They are not a fourth process. A crashed worker stops ingestion and indexing. Browse, search of the existing index, and download resolution keep running.

The worker handles `SIGTERM` and `SIGINT` by closing PostgreSQL and Redis.

## Queue

There is no Redis job queue. Jobs are rows in PostgreSQL.

Ingestion jobs retry up to 5 attempts with exponential backoff capped at 60 seconds, then move to `dead_letter`. Claiming uses `FOR UPDATE SKIP LOCKED`, so two workers do not take the same job. Reindex jobs are idempotent rebuilds of the derived search documents. Do not add another queue until a measured backlog needs it.

## Cache

Redis is optional. Production, if enabled, uses `rediss://` with a password and stays on the private network. Catalog cache entries expire after 60 seconds. Anonymous search responses may be cached; responses with a session cookie are `private, no-store`.

If Redis is down, the API still serves catalog and search from PostgreSQL. `/ready` stays successful.

## File storage

The Next.js build already contains the brand image, icons, and PWA files. The CDN may cache those. Do not create a bucket for movie binaries. Posters in the development seed point at example hosts; production artwork should be URLs the project is allowed to use, or files shipped as static assets. Neither path puts a film file on the API disk.

## CDN

Cache at the edge:

- `/_next/static/` and other fingerprinted assets, long-lived;
- brand icons and the manifest, short-lived or revalidated;
- public HTML for `/`, `/movies`, `/movie/:slug`, `/genres`, `/collections` only if the cache honors the page `Cache-Control` and is purged on release.

Do not cache:

- `/api/` responses that set a session cookie or `Cache-Control: private, no-store`;
- `/admin` and account pages;
- `/media/handoff/`;
- anything containing a credential.

The service worker is `no-store` so a bad worker script is not pinned.

## TLS and domains

Placeholders only. Do not create these records in this phase.

| Name | Use |
| --- | --- |
| `beezmovies.example` | public site |
| `www.beezmovies.example` | redirect to the apex |
| `api.beezmovies.example` | API |
| `staging.beezmovies.example` | staging site |
| `api.staging.beezmovies.example` | staging API |

The edge terminates TLS, redirects port 80 to HTTPS, and forwards to the private Node ports. Renew certificates automatically. Modern TLS only; disable TLS 1.0 and 1.1.

Session cookies are `Secure`, `HttpOnly`, and `SameSite=Lax` when `NODE_ENV=production`. The site and `api.` subdomain share a registrable domain, so the browser sends the cookie on API calls. Do not set a parent cookie domain wider than the API host.

HSTS belongs on the public HTTPS edge and is already emitted by the API in production. Do not send HSTS from the local development servers.

Proxy limits: body 1 MB, header timeout 20 seconds, upstream timeout 60 seconds, gzip or brotli for text. Forward `X-Request-Id` or let the API generate one. Security headers already set by Next.js in production and by the API should be preserved, not stripped.

## Security

- Public ingress is 443 only.
- SSH or the host control plane is restricted to named operators.
- Database and Redis security groups allow the API and worker only.
- Service accounts are separate for migrate, API, and worker. Migrate can run as a one-shot task with the same limited login.
- Admin HTML is on the same site and is not a secret URL. Protection is server-side role checks, the session cookie, audit events, and, at the proxy, an optional allowlist for `/admin` and `/api/v1/admin`. An allowlist must not cover public movie routes.
- MFA is not implemented. Until it exists, restrict admin paths at the proxy and keep the audit log.
- Sessions last 14 days. Password reset tokens last 30 minutes.
- Rate limits stay on auth, download resolution, and the general API.
- Apply operating-system security updates on a schedule. Do not major-upgrade Node dependencies on deploy day without a regression run.
- Provider credentials never go in the frontend, logs, or this document.

## Logging and monitoring

Each request log includes timestamp, level, `service`, `requestId`, method, route with the handoff token redacted, status, and duration. The sanitizer removes database URLs and `password`, `secret`, or `token` assignments. Do not log cookies, handoff tokens, or signed provider URLs.

| Signal | Alert |
| --- | --- |
| `/ready` failing for 2 minutes | page |
| 5xx rate above 5 percent for 5 minutes | page |
| API p95 above 1 second for 10 minutes | ticket |
| Postgres down, disk above 80 percent, or connections above 80 | page |
| Worker process exited | ticket |
| Ingestion dead-letter count increasing | ticket |
| Redis down | ticket, not a page; the site still serves |
| CPU above 85 percent for 15 minutes | ticket |

Do not alert on each failed provider health check. The admin providers screen already records health.

## Backup and restore

| Data | Method |
| --- | --- |
| Database | daily custom-format dump, plus WAL if available |
| Configuration | secret-store version history, not a Git commit |
| Migrations | the Git revision that was applied; `schema_migrations` records the names |
| Search index | derived; rebuild with the admin reindex job |
| Redis | not backed up |

Restore onto a spare database, never onto the live one first:

```bash
pg_restore --clean --if-exists --dbname SPARE_DATABASE beezmovies.dump
```

Then run `npm run migrate` against that spare URL, call `/ready`, open one known movie, sign in as an admin, and resolve one authorized download. A backup is verified only after that drill succeeds. It has not been run.

RPO: 24 hours with dumps, 15 minutes if WAL shipping is on. RTO: 4 hours for a single-node restore.

Recovery order: PostgreSQL, API, worker, Redis and search rebuild, frontend and CDN.

## Deployment sequence

Do not run this against a live domain in the current phase.

1. Provision the private network, database, optional Redis, and the edge proxy. Leave public DNS unchanged.
2. Load secrets for that environment.
3. Create the empty database and the limited login. Confirm the port is not public.
4. From a release checkout, `npm run migrate`.
5. Start the API. Confirm `/health` and `/ready`.
6. Start the worker. Confirm it logs `beezmovies-worker` and does not exit.
7. `npm run build --prefix frontend`, then `npm run start:frontend` with the production public URLs baked in at build time.
8. Point the proxy at the private frontend and API. Cache only the public static rules above.
9. Install TLS for the placeholder names when DNS is intentionally cut over later.
10. Run health checks.
11. Run the smoke tests below.
12. Only then attach public DNS.

## Smoke tests

- Homepage returns 200 and does not show the RC1 label.
- Search for a known title returns a result.
- A movie page returns its title and canonical URL.
- An anonymous session can open that page and request download resolution.
- Download resolution rejects a body that contains a URL.
- `/manifest.webmanifest` is standalone and names BeezMovies.
- An installed launch is the only path that plays the full bee flight. A normal browser visit does not.
- Admin login reaches the System page and shows `BeezMovies RC1`.
- An anonymous call to `/api/v1/admin/system` returns 401.
- A provider health check from an admin returns a status without a credential.
- `/ready` reports postgres `ok`.
- Stopping the worker leaves `/ready` ok.
- `/health` stays ok when the database is stopped; `/ready` becomes 503.

## Rollback

- Frontend: put the previous build back and reload the frontend process. CDN cache of HTML may need a purge. Fingerprinted `/_next/static` files can stay.
- API: start the previous release. It must understand the current schema.
- Worker: start the previous worker after the API is healthy.
- Configuration: restore the previous secret version and restart API and worker.
- Database: do not run a down migration. Migrations are forward-only. If a migration must be undone, restore the spare-tested dump onto a new database and point `DATABASE_URL` at it, or apply a new forward migration that repairs the data. Assume a down migration is unsafe.

## Environment matrix

| | Development | Staging | Production |
| --- | --- | --- | --- |
| Site | `http://localhost:3000` | `https://staging.beezmovies.example` | `https://beezmovies.example` |
| API | `http://localhost:5000/api/v1` | `https://api.staging.beezmovies.example/api/v1` | `https://api.beezmovies.example/api/v1` |
| Database | local `beezmovies` | `beezmovies_staging` on a private host | `beezmovies_production` on a private host |
| Secrets | `backend/.env`, not committed | staging secret store | production secret store |
| Media | `development-media` text handoff | test references only | contracted provider references |
| Ads and analytics | off | separate test credentials, or off | off until reviewed |
| Logs | pretty local logs | structured JSON, 14 days | structured JSON, 30 days |
| Monitoring | none | ready check and error rate | the alert table above |
| Deploy | `npm run dev:*` | same commands as production, staging secrets | the sequence above |

Staging uses its own database, secrets, and provider credentials. It must not use the production `DATABASE_URL`.

## Load tests

Run load tests only against hosts you control: the staging homepage, movie list, movie detail, and search. Do not send load at external media providers or at handoff URLs that call a provider. Stop if the error rate exceeds 1 percent. Record p50 and p95. Do not treat a single-machine result as production capacity.

## Cost

Compute, database, and cache start in the LOW to MEDIUM bands above. CDN bandwidth is MEDIUM if pages and images are cached and video is not proxied. A media or ad network that bills per request is a separate HIGH variable. No vendor prices are stated because no host is selected.

## Steps still required before a real deployment

1. Initialize Git and confirm `.env` is untracked.
2. Choose a host and a private network. Do not open 5432 or 6379.
3. Create the production secret values, including `sslmode=verify-full` and a unique handoff secret.
4. Run one `pg_dump` / `pg_restore` drill on a spare database and record the result.
5. Decide whether admin paths are IP-restricted at the proxy. MFA is not in the application.
6. Build the frontend with the production public URLs and smoke-test it with `next start` on the private network.
7. Leave ads, affiliate credentials, and real provider tokens disabled until terms are reviewed.
8. Cut DNS over only after the smoke tests pass.
