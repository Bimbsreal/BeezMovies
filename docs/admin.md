# Admin control plane

The operational CMS, including unpublish, restore, genre merge, homepage preview, and settings groups, is documented in [admin-cms.md](admin-cms.md).

The admin area is private. Guessing `/admin` or `/api/v1/admin` does not grant access. Every admin API route requires a session cookie and the `admin.access` permission. Catalog writes, account status, and role changes use additional permissions. The public site does not render this interface.

## Roles and permissions

| Role | Permissions |
| --- | --- |
| `user` | None of the admin permissions |
| `admin` | `admin.access`, `admin.catalog`, `admin.users` |
| `super_admin` | Those three, plus `admin.roles` |

`admin.roles` is required to change another account's roles. An administrator cannot change their own roles or deactivate their own account. Role values sent by the browser are ignored; the API reads roles from the session user loaded in PostgreSQL.

The development seed account `admin@beezmovies.local` has `user`, `admin`, and `super_admin`.

## Routes

| Path | Purpose |
| --- | --- |
| `/admin` | Redirects to the dashboard |
| `/admin/dashboard` | Live catalog, ingestion, media, search, and system counts |
| `/admin/movies` | Search, filter, sort, paginate, and queue bulk actions |
| `/admin/movies/[id]` | Edit curated metadata, publish, or archive |
| `/admin/genres` | Create, rename, and archive genres |
| `/admin/collections` | Create, publish, archive, and reorder movies |
| `/admin/people` | Inspect people and credit departments |
| `/admin/media` | Inspect, validate, enable, disable, or archive references |
| `/admin/providers` | Status, health, credential presence, enable, and disable |
| `/admin/ingestion` | Jobs and controlled ingestion |
| `/admin/ingestion/[id]` | Job detail and retry |
| `/admin/search` | Index status, movie reindex, batch reindex, full reindex |
| `/admin/users` | Account status and, for super admins, roles |
| `/admin/system` | Health, PWA facts, and the private operations note |
| `/admin/audit` | Recent administrative actions |

`/admin` is disallowed in `robots.txt` and is not cached by the service worker.

## Protected API

All routes are under `/api/v1/admin` and use the existing session cookie. Unsafe methods require the `x-beezmovies-request: 1` header. Bodies, query strings, and params are validated. Database failures return `ADMIN_UNAVAILABLE` without SQL text.

Catalog routes require `admin.catalog`. User status requires `admin.users`. Role changes require `admin.roles`.

| Method | Path |
| --- | --- |
| GET | `/dashboard`, `/audit`, `/system`, `/movies`, `/movies/:id`, `/genres`, `/collections`, `/people`, `/media`, `/providers`, `/users`, `/search/status` |
| PATCH | `/movies/:id`, `/genres/:id`, `/collections/:id`, `/users/:id`, `/settings` |
| POST | `/movies/bulk`, `/movies/:id/publish`, `/movies/:id/archive` |
| POST | `/genres`, `/genres/:id/archive`, `/collections`, `/collections/:id/publish`, `/collections/:id/archive`, `/collections/:id/order` |
| POST | `/media/:id/disable`, `/media/:id/enable`, `/media/:id/archive`, `/media/:id/validate` |
| POST | `/providers/:id/enable`, `/providers/:id/disable`, `/providers/:id/health-check` |
| POST | `/users/:id/roles`, `/search/movies/:id/reindex`, `/search/reindex/batch`, `/search/reindex/full` |
| POST | `/ingestion/jobs/:id/retry` |

Existing ingestion and search routes remain: `GET/POST /ingestion/jobs`, `GET /ingestion/jobs/:id`, `GET /ingestion/sources`, `GET /ingestion/activity`, and `POST /search/reindex`.

## Catalog curation

Public movie status stays `draft`, `active`, or `archived`. The admin UI labels `active` as Published. Archived movies stay out of public lists and search. Publishing and archiving are explicit POSTs and require `confirm: true`.

A manual edit writes `catalog_field_provenance.origin = manual`. Ingestion treats that field as higher priority than any source, so a later metadata job does not replace it. The public slug is not editable.

## Bulk operations

Publish, archive, and reindex accept at most 100 movie ids and require `confirm: true`. The request records an `admin_operations` row, returns HTTP 202, and continues after the response. Each movie change is audited. Full search reindex uses the existing asynchronous reindex job and also requires confirmation.

## Ingestion, search, and providers

Ingestion accepts a known source slug and an optional external id. Arbitrary URLs are rejected. Failed and dead-letter jobs can be returned to `pending`.

Provider responses show credentials as `Configured` or `Not configured`. Secrets, password hashes, and session tokens are not returned. Media removal is an archive of the reference, not a provider-side delete.

## Audit

`admin_audit_events` stores the administrator, action, target, timestamp, result, and a small metadata object. Password, hash, token, and API key fields are dropped before insert and rejected by a database check. Structured logs use the same action name and omit those fields.
