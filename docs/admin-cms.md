# Admin CMS

The administrative area is a separate interface from the public site. Public browsing, search, movie pages, and authorized downloads stay available without an account. `/admin` is `noindex` and disallowed in `robots.txt`.

Every admin API route is under `/api/v1/admin` and checks the session itself. A hidden frontend route is not authorization.

## Roles

| Role | Permissions |
| --- | --- |
| `user` | No admin permissions |
| `admin` | `admin.access`, `admin.catalog`, `admin.users` |
| `super_admin` | Those permissions, plus `admin.roles` |

`admin` covers catalog, homepage rails, ingestion, search, providers, and account status. `super_admin` is required to change another account's roles. An administrator cannot change their own roles or deactivate their own account. There is no separate moderator or operations login. Those duties use the same explicit permissions above, so a content administrator does not receive role administration.

The development account `admin@beezmovies.local` has `user`, `admin`, and `super_admin`. Its password is a local fixture.

Sessions use the existing HttpOnly cookie, expiration, CSRF header on unsafe methods, and rate limits. Multi-factor authentication is not part of this application. Passwords, hashes, session tokens, and provider credentials are not returned by admin responses.

## Routes

| Path | Purpose |
| --- | --- |
| `/admin/dashboard` | Live catalog, media, ingestion, search, user, and system counts |
| `/admin/movies` and `/admin/movies/[id]` | Create, edit, publish, unpublish, archive, restore, validate, refresh, and reindex |
| `/admin/reviews` | Duplicate, incomplete, conflicting, and failed-ingestion review. Approve keeps records separate. Merge requires an explicit confirmation. |
| `/admin/collections` | Create, edit order, publish, archive, and reindex member movies |
| `/admin/genres` | Create, rename, merge into another genre, and archive |
| `/admin/homepage` | Rail title, source, order, item limit, and visibility, with the current public rails shown beside unsaved edits |
| `/admin/users` | Search, status, suspension, and restore. Role changes require `admin.roles` |
| `/admin/providers` | Enable, disable, and health check. Credentials stay on the server |
| `/admin/ingestion` | Queued, running, completed, failed, retrying, and dead-letter jobs |
| `/admin/search` | Index status, movie reindex, batch reindex, and confirmed full reindex |
| `/admin/system` | HEALTHY, DEGRADED, or DOWN checks, plus confirmed operational flags |
| `/admin/settings` | General, catalog, search, media, PWA, monetization, security, and system groups |
| `/admin/audit` | Append-only administrative history |

Older paths `/admin/review` and `/admin/rails` still render the same screens.

## Movie management

Public status remains `draft`, `active`, or `archived`. The editor labels `active` as Published. Unpublish returns an active movie to draft. Restore returns an archived movie to draft. Neither action deletes the row or its canonical id and slug.

A saved field is marked manual in `catalog_field_provenance`. The editor shows that source as Manual override. Fields written by a catalog source show that source name. Later ingestion does not replace a manual field.

Cast, crew, posters, backdrops, trailers, external ids, and media references are shown from stored rows. Media reference secrets and provider credentials are not included. Bulk actions are publish, archive, and reindex. They require confirmation and run after the response. Bulk delete is not available.

## Collections, genres, and homepage

Collections store title, description, slug, and status. Movie order is an explicit list. Archiving unpublishes the collection. Reindex queues search updates for the movies in that collection.

Genre merge copies movie links onto the target genre, removes the source links, and archives the source genre. It does not delete the genre row. Two genres cannot be merged automatically from a title similarity.

Homepage rail source types stay fixed. Administrators can change title, order, item limit, and visibility. The page shows the unsaved enabled order and the rails currently returned by the public homepage.

## Ingestion, search, and providers

Ingestion accepts a known source slug. Arbitrary URLs are rejected. Failed and dead-letter jobs can be retried to pending. The job status set does not include a separate cancel value, so a queued job is not deleted from the admin screen.

Search reindex for one movie updates that document. Full reindex and collection reindex are asynchronous and require confirmation.

Disabling a provider updates that provider's status. Movie rows and curated metadata stay in place. A provider error is recorded as health, not as a failed API process.

## Users, audit, and settings

User search returns email, display name, status, roles, created time, and last sign-in. It does not return passwords or tokens. Suspension blocks sign-in. It does not block anonymous browsing or authorized downloads.

Audit rows store actor, action, target, timestamp, and result. Metadata cannot contain password, token, or API key fields. There is no admin route to edit or delete audit rows.

Settings are grouped for operators. The only database-backed note is the operations text. Feature flags and maintenance stay on the system screen and require confirmation. Provider secrets and session secrets stay in environment configuration.

## PWA

The system and settings screens report whether the manifest, service worker, icons, startup logo, and bee artwork are present on disk. The admin UI does not delete those files.

## Cache

Movie publish, unpublish, archive, restore, and metadata edits invalidate that movie's catalog cache and the discovery generation. Collection and rail edits do the same for homepage data. They do not flush unrelated cache entries.
