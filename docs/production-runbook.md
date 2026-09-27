# BeezMovies production runbook

Release identifier: `1.0.0-rc.1` (BeezMovies RC1). Latest migration file: `018_content_rights.sql`. Configuration version: the `*.env.production.example` files. Deployment time: not deployed. Commit: this workspace is not a Git repository, so there is no commit id.

This runbook operates the processes that already exist. It does not add a second application or store movie files on the API host. Topology and cache rules stay in [production-architecture.md](production-architecture.md) and [production-deployment.md](production-deployment.md).

## Environments

| | Development | Staging | Production |
| --- | --- | --- | --- |
| Database name | `beezmovies` | `beezmovies_staging` | `beezmovies_production` |
| Secrets | `backend/.env` | staging secret store | production secret store |
| Public site variables | `frontend/.env.local` | `frontend/.env.staging.example` | `frontend/.env.production.example` |
| Seed | `npm run seed` | `BEEZ_SEED_TARGET=staging npm run seed:staging` | refused |
| Auth | local fixture admin | no development admin | no development admin |
| Providers | `development-media` | test references only | contracted references only |
| Analytics | first-party tables | separate database | separate database |

`NEXT_PUBLIC_*` values are visible in the browser. Database URLs, handoff secrets, and provider credentials stay on the API and worker.

## Restart application

On the target host, with that environment's secrets loaded:

```bash
node backend/src/index.js
```

`NODE_ENV=production` exits before listen if `DATABASE_URL`, `MEDIA_HANDOFF_SECRET`, or `CORS_ORIGIN` is missing or still a development fixture. Send `SIGTERM`. The process stops accepting connections, waits up to 10 seconds, then closes PostgreSQL and Redis. Start the new process only after `/health/live` on the old process has stopped. Do not run a second copy against the same port.

Frontend production runtime is `npm run start --prefix frontend` after `npm run build --prefix frontend`. Do not use `next dev`.

## Restart worker

```bash
node workers/src/bootstrap.js
```

One worker is enough. A stopped worker does not stop public browse or download resolution. Restart it after `/health/ready` is ok.

## Inspect queue

Jobs are rows in PostgreSQL, not a Redis list. From an admin session, open `/admin/ingestion`. Status labels are Queued, Running, Completed, Failed, Retrying, Cancelled, and Dead letter. Retry and cancel require confirmation. Do not delete job rows by hand.

## Check database

`GET /health/ready` must report postgres required and ok. `GET /health/live` must stay ok even when the database is down. Migrations are applied with `npm run migrate` from a release checkout. The applied names are in `schema_migrations`. Do not edit production tables as a deploy step.

## Check Redis

Redis is optional. `/health/ready` may report it unavailable and still return 200. If `REDIS_URL` is set in production it must not be localhost. Cache misses read PostgreSQL.

## Check provider

Use the admin provider health action. Do not paste credentials into logs. If a provider is down, disable that provider. Resolution uses the next authorized reference or returns a clean error.

## Rollback release

Stop the new frontend, API, and worker only after the previous build is ready to listen. Start the previous build. It must already understand the current schema. Do not run a down migration. Configuration rollback is the previous secret-store version, then a process restart.

A destructive migration is undone by restoring a spare-tested dump onto a new database and pointing `DATABASE_URL` at that database, or by a new forward migration. Do not automatically roll a migration backward.

## Restore backup

No backup is configured on this machine, and no restore has been run. When a dump exists:

```bash
pg_restore --clean --if-exists --dbname SPARE_DATABASE beezmovies.dump
```

Run that against a spare database. Then `npm run migrate` against that spare URL, call `/health/ready`, open one movie, and resolve one authorized download. Record the dump timestamp, where the file is stored, and that the spare restore worked. Retention target is 30 daily and 12 monthly copies off the database host. Encryption depends on the host; none is configured here.

## Handle outage

Follow [incident-response.md](incident-response.md).

1. Detection. `/health/ready` failing, a System alert, or an error-rate alert.
2. Assessment. `/health/live` versus `/health/ready`, worker heartbeat, provider health, and the last deploy.
3. Containment. Disable the failing provider or feature flag. Leave authentication and CORS on.
4. Recovery. Restart the failed process, or restore a spare database and point `DATABASE_URL` at it.
5. Verification. Logged-out homepage, search, movie, trailer state, and download, then an admin System check.
6. Post-incident review. Record start, cause, and the change. Do not paste secrets.

## Handle provider failure

Disable the provider in admin. Public pages keep rendering. Download returns the existing unavailable response when no authorized reference remains. Do not proxy a caller-supplied URL.

## Release checklist

- [x] Syntax check passes (`npm run release:check`)
- [x] Application tests pass on the local development database
- [x] Security regression from the prior audit has no critical code defect
- [x] Migration files `001` through `018` are ordered and applied by `npm run migrate`
- [ ] Backup verified
- [ ] CDN configured
- [ ] HTTPS configured
- [x] Environment examples verified, with secrets kept out of `NEXT_PUBLIC_*`
- [ ] Workers healthy on a production host
- [ ] Queue healthy on a production host
- [ ] Redis healthy
- [ ] Monitoring active off this machine
- [x] Anonymous browsing works on the local site
- [x] Download flow works on the local site for an authorized reference
- [x] Admin authorization returns 401 and 403 for non-admins
- [ ] PWA install verified on a production origin
- [x] SEO rules exclude admin and account routes in code
- [x] Rollback documented

Production deployment still requires the unchecked rows.
