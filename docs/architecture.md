# BeezMovies architecture

This document describes the foundation boundaries. It is not a feature roadmap.

## Boundaries

| Boundary | Responsibility |
| --- | --- |
| `frontend/` | Next.js UI, SEO metadata, PWA shell, official brand asset |
| `backend/` | Versioned REST API, configuration, logging, security middleware, process lifecycle |
| `database/` | Forward SQL migrations for the catalog and for identity. |
| `workers/` | Separate Node process for future background jobs |
| `infrastructure/` | Local-only Docker Compose for PostgreSQL and Redis |

The frontend does not connect to PostgreSQL. The API does not render pages. Workers do not serve HTTP.

## Request path

1. The browser loads the Next.js shell on port 3000.
2. Browser calls to the API go to port 5000 under `/api/v1`.
3. Express applies a request id, structured request log, Helmet, CORS, and a body size limit.
4. `/api/v1/health` reports process liveness and does not touch the database.
5. `/api/v1/ready` checks PostgreSQL. Redis is reported, and it is not required.
6. Unknown routes and thrown errors use one JSON error body.

## API

All HTTP routes are mounted at `/api/v1`. Later resources are added on that router, behind the shared rate limiter. Health and readiness are excluded from the limiter so probes stay available.

Error JSON:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found"
  }
}
```

Production responses for unexpected failures use a generic message and omit stack traces. Connection strings are stripped from client-facing text.

Validation is a Zod schema in front of a route handler. The parsed value is placed on `req.validated`.

## Data

The API uses the `pg` driver and a small pool in `backend/src/db/pool.js`. There is no ORM.

`backend/src/db/migrate.js` applies `database/migrations/*.sql` in order. Each file runs in a transaction, then its name is stored in `schema_migrations`. The first migration creates `app_meta`, which readiness reads to confirm the foundation schema is present.

PostgreSQL is the source of truth for the catalog and for accounts. Redis, the search index, and CDN copies are derived and must not become the movie database or the identity store. The catalog tables are described in [catalog-schema.md](catalog-schema.md). The catalog HTTP API is described in [catalog-api.md](catalog-api.md). Search is described in [search.md](search.md). The public movie pages are described in [public-experience.md](public-experience.md). Download resolution is described in [media-providers.md](media-providers.md). Sessions, roles, and password hashing are described in [auth.md](auth.md).

## Redis and workers

`backend/src/redis/client.js` is the only Redis connection implementation. `initRedis()` pings when `REDIS_URL` is set. Failure marks Redis unavailable and leaves the process running.

`workers/src/index.js` is the worker entry. It reuses that client. The metadata ingestion cycle and the search index cycle are registered there. Both poll PostgreSQL when Redis is unavailable.

The API rate limiter uses an in-memory store for one process. A shared Redis store can replace that store later without changing route code.

## Frontend shell

The App Router layout mounts three stable pieces:

- `StartupSequence`, which plays the bee-flight order on an installed launch: enter, fly, wordmark, cinematic transition, homepage. A normal browser visit skips it. The sequence is CSS on the official artwork and does not block the catalog request.
- `AppShell`, the header, content area, and footer.
- `ServiceWorkerRegistration`, active in production builds.

The official bee file is `frontend/public/branding/beezmovies-logo.jpg`. The header and manifest keep that file. `beezmovies-bee.png` is the same artwork with the black JPEG matte removed for the flight. Square icons at 192, 512, and the maskable 512 are scaled from that artwork onto `#0B0D0F` without changing the bee.

Paths under `/admin` use a separate operational frame. They stay on the same session cookie. Authorization is enforced by `/api/v1/admin`. See `docs/admin.md`.

## PWA cache

`frontend/public/sw.js` uses a versioned static cache.

- Hashed static files and brand images: cache first.
- Document navigations: network first, then cache.
- Cross-origin requests, `/api/`, requests carrying `Authorization`, and the account/auth pages: not cached.
- A new cache name drops older caches on activate.
- A waiting worker activates only after a `SKIP_WAITING` message, so an update can be applied deliberately.

The service worker is registered in production so local development does not keep a stale shell.

## Configuration and shutdown

Backend settings come from environment variables loaded by `backend/src/env.js`. The server refuses to boot without `DATABASE_URL`. It still listens if PostgreSQL is temporarily down, and readiness returns HTTP 503.

SIGINT and SIGTERM close the HTTP server, the PostgreSQL pool, and Redis.

## Related documents

The public movie pages are described in [public-experience.md](public-experience.md). Monetization placements are server-controlled and stay collapsed until a verified provider is enabled, as described in [monetization.md](monetization.md). Authentication is the cookie session and role foundation in [auth.md](auth.md). The catalog API reads PostgreSQL through repositories and serializers. Search reads a derived PostgreSQL index that is rebuilt from the catalog, as described in [search.md](search.md). Download requests validate an authorized catalog reference and do not return provider tokens. Admin operations are described in [admin.md](admin.md).
