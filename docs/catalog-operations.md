# Catalog operations

PostgreSQL is the canonical catalog. Search documents, cache entries, and download handoffs are derived from it. Movie video files are not stored on the application server.

Public movie URLs stay `/movie/{slug}`. Existing slugs such as `nosferatu` are not rewritten when metadata changes. A confirmed merge archives the duplicate, retires its slug with a `-merged` suffix, and records the old slug in `movie_slug_redirects`. The public page redirects to the keeper.

## Ingestion and duplicates

An external identifier is unique per catalog source. Running the same ingestion job again updates that movie instead of inserting another. Title similarity alone never merges records. Medium-confidence collisions become pending rows in `ingestion_reviews`.

`Sci-Fi` and `Science Fiction` normalize to the genre slug `science-fiction`. Other genre names keep their capitalization and punctuation.

## Provenance and manual edits

`catalog_field_provenance` records the source, field, and transformation version. A manual edit is stored with origin `manual` and a protected priority, so a later ingestion refresh does not overwrite that field.

## Publishing

Movie status remains `draft`, `active`, and `archived`. The admin interface calls `active` Published. Draft and archived movies are not on public lists. `POST /api/v1/admin/movies/:id/validate` reports missing title, release, synopsis, genre, or poster. It does not delete the movie. Runtime, country, and tagline stay optional.

## Review and merge

`/admin/review` lists pending candidates. Approve means the records stay separate. Reject dismisses the candidate. Neither action merges.

`POST /api/v1/admin/movies/:id/merge` with `{ sourceId, confirm: true }` keeps `:id`, moves non-conflicting identifiers, genres, and media references, archives the source, and queues a search update for both ids. The source row is not deleted. There is no automatic merge.

## Media availability

A movie can stay published when its media reference is unavailable. Download resolution returns a clean error. The worker checks at most one enabled-provider reference every 15 minutes, and only if that reference is older than six hours. It uses the configured adapter and does not fetch an arbitrary URL.

## Search and cache

Movie edits call the existing targeted document update and invalidate that movie slug, the genre list, and the collection list. A full reindex remains an admin action. Search cache is cleared when the index write finishes, not on every unrelated read.

## Admin routes

All of these require an authenticated administrator. Writes also require `admin.catalog` and `confirm: true`.

- `GET /api/v1/admin/catalog-health`
- `GET /api/v1/admin/review`
- `POST /api/v1/admin/review/:id`
- `POST /api/v1/admin/movies/:id/validate`
- `POST /api/v1/admin/movies/:id/merge`
- Existing publish, archive, reindex, and bulk routes stay in place.

`/admin/catalog-health` and `/admin/review` are the matching pages.
