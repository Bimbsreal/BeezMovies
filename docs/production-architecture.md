# BeezMovies production architecture

This document describes the production shape of BeezMovies RC1. It does not deploy the service, create DNS records, or store movie binaries. The operational steps are in [production-deployment.md](production-deployment.md). Staging is not deployed. A restore drill has not been run.

The application servers are not the media-storage layer. Download resolution reads a stored provider reference and hands the browser an authorized response. The video file stays at the provider.

```
Internet
  │
  ▼
Edge / CDN
  │
  ├──────────────────────┐
  ▼                      ▼
Next.js PWA            API
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
    Ingestion    Search    Media health

API → media adapter → authorized external provider → browser
```

PostgreSQL is the source of truth. Redis, when present, holds only short-lived cache and an optional job wake-up. Canonical catalog, sessions, and jobs are not stored in Redis.

## Deployment

No hosting vendor is selected. The intended release is rolling: start a new API process, wait until `/health/ready` is successful, then shift the proxy. The previous process drains for up to 10 seconds on `SIGTERM`.

Database migrations are versioned files in `database/migrations`, applied once through `schema_migrations`, inside a transaction per file. They are forward-only. A migration must be compatible with the application version that is still serving traffic. `npm run seed` refuses `NODE_ENV=production`.

Development, staging, and production use separate databases, `DATABASE_URL` values, `MEDIA_HANDOFF_SECRET` values, and provider credentials. This workspace uses the local database only. Do not point another environment at it.

## Environment variables

Server-only: `DATABASE_URL`, `REDIS_URL`, `MEDIA_HANDOFF_SECRET`, `PG_POOL_MAX`, `PG_QUERY_TIMEOUT_MS`, `MEDIA_PROVIDERS`, `CORS_ORIGIN`.

Public by design: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`.

Do not put secrets in `NEXT_PUBLIC_*` variables, logs, or this document. `.env` stays untracked.

## CDN and caching

Public anonymous catalog and search responses send `Cache-Control: public` with a short max-age, plus `Vary: Accept-Encoding` and a weak `ETag`. A matching `If-None-Match` returns 304.

Do not cache responses that set `Cache-Control: private, no-store`: accounts, watchlists, favorites, admin, downloads, handoff, analytics, and any response that arrived with a session cookie.

`/health`, `/health/live`, `/health/ready`, `/api/v1/health`, and `/api/v1/ready` are `no-store`.

Fingerprinted `/_next/static` assets use `public, max-age=31536000, immutable`. Brand images under `/branding` use a one-day public cache. The service worker and manifest stay uncached so a bad worker is not pinned. The service worker does not cache API responses.

## Database

The API pool defaults to 10 connections, 5 second connect timeout, 30 second idle timeout, and 20 second query timeout (`PG_QUERY_TIMEOUT_MS`). The worker opens its own pool. Keep PostgreSQL `max_connections` at 100 or higher. Search queries also set a shorter local statement timeout.

Indexes already cover movie slug, external identifiers, media references, users, library rows, ingestion job claims, and analytics rollups. New indexes are not added without a measured query plan. Public lists are paginated.

## Redis

Redis is optional and is not running on this workstation. Catalog and search fall back to PostgreSQL. `/health/ready` stays successful when Redis is absent. Rate limits use an in-process store until a shared store is measured as necessary.

## Queues and workers

PostgreSQL is the queue. Ingestion, search indexing, and media-health checks run as separate worker tasks. A task that is still running is not started again, and each task is bounded at 20 seconds so one provider wait does not stop the others. Ingestion retries use exponential backoff, a maximum attempt count, and `dead_letter`. Metadata sources that fail repeatedly are disabled until a cooldown ends. That is the circuit breaker. It does not bypass a provider limit.

Analytics recording is a separate in-process queue and does not write operational logs into product analytics.

## Rate limiting and abuse

Production limits, per 15 minutes: API 100, authentication 10, download resolution 30. Development limits are higher so local browsing stays usable. Health probes are excluded. The limiter returns 429 with `RATE_LIMITED`. It does not fingerprint clients.

## Observability

Each request log includes the request id, method, path, status, and duration. Passwords, handoff tokens, and provider secrets are redacted. Admin system status reports database connections, pool waiters, process memory, queue backlog, worker heartbeat, cache state, and backup age. Alerts are raised only for database loss, backup failure, download failure, a stale worker, search outage, provider outage, ingestion dead letters, cache loss, and a waiting pool. Small traffic changes do not alert.

Liveness (`/health/live`) answers without dependencies. Readiness (`/health/ready`) requires PostgreSQL and treats Redis as optional. Neither response includes credentials.

## Backups and disaster recovery

The intended backup is a daily custom-format `pg_dump` kept off the database host: 30 daily copies and 12 monthly copies. WAL archiving, when the host supports it, targets a 15-minute RPO. With dumps only, the RPO is 24 hours. The RTO is the time to provision a new database and restore the dump; that time has not been measured because the restore drill has not been run.

Do not restore over the local or production database as a test. Restore into an empty spare database, run `/health/ready`, and compare a known catalog row.

Recovery:

- Database loss: restore the newest verified dump into a new instance, point `DATABASE_URL` at it, and restart the API and worker.
- Application failure: the proxy shifts back to the previous process. Static assets stay on the previous frontend build.
- Worker failure: browse, search of the existing index, and download resolution continue. Ingestion and indexing pause until the worker heartbeat returns.
- Provider outage: download resolution tries the next authorized reference. Browsing and search do not call the media provider.
- CDN failure: the origin still serves HTML and API responses. Video playback is the provider’s availability, not the CDN’s.

## Security

API responses use Helmet: `nosniff`, `no-referrer`, `frame-ancestors 'none'`, a locked API content-security policy, and HSTS only when `NODE_ENV=production`. The site CSP is production-only so local development is not broken. CORS allows the configured site origin. Unsafe methods require `X-BeezMovies-Request`. Queries are parameterized. Metadata URL fetches reject private and local addresses. Admin routes check authorization on the server.

## PWA

The manifest, service worker, icons, and bee artwork are required startup assets. The startup animation is unchanged. The service worker caches the offline shell and does not cache authenticated or download responses.

## Performance

Artwork uses explicit dimensions, lazy loading for non-priority images, and async decoding. Missing artwork stays an empty placeholder. It is not replaced with a fabricated image.

## Load tests

`backend/scripts/load-check.mjs` sends a small sequential sample to a local or staging base URL. It refuses `NODE_ENV=production`. The numbers are synthetic and are not a capacity claim. Server CPU is not sampled by that script.

## Cost

The large cost drivers, once deployed, are the PostgreSQL instance, CDN bandwidth for pages and artwork, the API and worker processes, optional Redis, and provider API volume. Video bandwidth stays with the media provider. Do not remove backups or readiness checks to reduce cost.

## Rollback

Keep the previous frontend build and API checkout. Shift the proxy back. Do not roll back a database migration by editing tables. If a migration cannot be reversed, restore the spare database from the dump taken before the release.

## Readiness checklist

| Area | State on this workspace |
| --- | --- |
| Architecture | Documented. Application and media storage are separate. |
| Database | Local PostgreSQL. Pool and query timeouts are set. |
| Cache | Optional Redis. Absent here. PostgreSQL remains authoritative. |
| CDN | Rules are defined. No edge is deployed. |
| Workers | Code is isolated per task. The worker process is not running. |
| Queues | PostgreSQL jobs, backoff, and dead letter are in place. |
| Security | Headers, CSRF, auth, SSRF checks, and rate limits are in place. |
| Backups | Procedure is documented. No backup has been recorded. |
| Monitoring | Admin system status and alerts exist. No pager is connected. |
| PWA | Shell, bee artwork, and service worker are present. |
| Performance | Local timings only. |
| Deployment | Not deployed. |
| Rollback | Procedure is documented. Not rehearsed. |
| Disaster recovery | RPO and RTO are stated from the backup design. Restore is not tested. |
