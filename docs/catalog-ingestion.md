# Catalog ingestion

Metadata ingestion is a background pipeline. It does not serve the public website, and it does not store movie binaries. A discovered record is not a downloadable media reference.

The local adapter is `development-metadata`. Another approved source can be added by registering an adapter. Application code asks the registry for an adapter by slug. It does not call one provider by name.

## Adapter contract

Each adapter exposes:

- `searchTitles`
- `getMovie`
- `getCredits`
- `getImages`
- `getExternalIdentifiers`

Each adapter declares its name, authentication requirement, endpoints, rate-limit policy, supported metadata, attribution, and error categories. The pipeline reads that descriptor from the registry. `catalog_source_runtime` stores the numeric request rate, minimum interval, concurrency, priority, and allowed hosts. Secrets stay in server environment variables. The runtime configuration rejects password, secret, token, and API-key fields.

Attribution stays on the catalog source and on `catalog_field_provenance`. Responses from a source are untrusted until normalization accepts them.

## Schedules

`ingestion_schedules` holds intervals of at least one hour. The worker checks due schedules at most every 15 minutes, and only while the ingestion flag is on.

| Schedule | Discovery kind |
| --- | --- |
| discovery | `NEW_RELEASE_DISCOVERY` |
| initial import | `POPULAR_DISCOVERY` |
| periodic update | `REVALIDATION` |
| stale refresh | `METADATA_REFRESH` |

Stale refresh queues up to 20 external ids that have never been synchronized or are older than 7 days (`METADATA_REFRESH`). It also queues up to 10 movies missing a synopsis (`MISSING_METADATA`) and up to 10 movies missing a poster (`MISSING_ARTWORK`). A missing poster is left empty. The pipeline does not invent artwork and does not download image files. Unavailable media references are checked by the existing media sweep, one configured reference at a time, through that provider’s adapter. Discovery itself enqueues at most 25 child upserts. An active job with the same idempotency key is not queued again.

## Queue

PostgreSQL is the durable queue. Redis is only an optional wake-up.

Stored statuses are `pending`, `processing`, `completed`, `failed`, `dead_letter`, and `cancelled`. The admin screen labels them:

| Stored status | Label |
| --- | --- |
| `pending`, first attempt, available now | Queued |
| `pending` with a later `available_at`, or `failed` with attempts left | Retrying |
| `processing` | Running |
| `completed` | Completed |
| `dead_letter` | Dead letter |
| `cancelled` | Cancelled |

A job keeps its source, external id, operation, payload, and attempt count so a retry uses the same work. Cancelling is allowed for `pending` and `failed` jobs and requires `confirm: true`. A cancelled job no longer blocks a new job with the same key.

Pause and resume use the existing ingestion feature flag. The worker returns immediately while that flag is off. Both actions require confirmation. They do not enable maintenance mode.

## Normalization and provenance

Incoming records are validated, then mapped to the canonical title, original title, synopsis, release date, runtime, language, country, genres, cast, crew, artwork references, and external ids. Text is stored as plain text. Genre names use the existing canonical map. Artwork is an HTTPS reference on a host allowed for that source. Missing artwork is left empty.

`catalog_field_provenance` records which source last wrote a field. A later source replaces a field only when its priority is higher, or when the priority is equal and its source timestamp is newer. A manual provenance row stays authoritative.

## Duplicates

Matching uses an external id first. The same source id cannot belong to two movies. A confident title, year, and trusted-id match updates the existing movie. A same-title candidate that is not confident becomes an `ingestion_reviews` row with status `pending`. Those rows appear in `/admin/reviews`. The pipeline does not merge them.

## Quality gate and publication

New movies are inserted as drafts. A new movie is set to `active` only when it has a title, release date or year, synopsis, genre, primary poster reference, and external id. Anything missing stays a draft and the job result is `pending_review`. Updating an existing movie does not unpublish it.

Manual publish in the admin CMS remains a separate action. Its validation report is advisory.

## Media

Metadata adapters do not create `media_references`. A discovered movie is not an authorized download. The media adapter checks a stored reference on the server, validates the response, records provider health, and does not return provider secrets. It does not scrape or follow a caller-supplied URL.

## Search and cache

A successful create or update inserts one `search_index_events` row for that movie. It does not rebuild the index. The same change drops that movie's catalog cache entry, the genre and collection list entries, the homepage discovery generation, and the search cache generation.

## Retries, limits, and retention

Transient failures, including provider unavailability and database connection errors, return the job to `failed` and move `available_at` forward with exponential backoff. The attempt count is capped. A permanent validation failure goes to `dead_letter`. A disabled source is left alone until its cooldown ends. The client does not retry around a rate limit.

Completed and cancelled jobs older than 30 days are deleted. Dead-letter jobs are kept for 180 days. The worker performs that prune on the same 15-minute schedule tick.

## Admin API

All of these routes require an admin session:

- `GET /api/v1/admin/ingestion/sources`
- `GET /api/v1/admin/ingestion/jobs`
- `GET /api/v1/admin/ingestion/jobs/:id`
- `GET /api/v1/admin/ingestion/metrics`
- `POST /api/v1/admin/ingestion/jobs`
- `POST /api/v1/admin/ingestion/jobs/:id/retry`
- `POST /api/v1/admin/ingestion/jobs/:id/cancel`
- `POST /api/v1/admin/ingestion/batches`
- `POST /api/v1/admin/ingestion/queue`
- `POST /api/v1/admin/ingestion/retry-failed`
- `POST /api/v1/admin/ingestion/validate`
- `POST /api/v1/admin/ingestion/reindex`

Retry-failed returns at most 25 failed or dead-letter jobs to the queue. Validate reports the quality gate for one movie and does not publish it. Reindex updates that movie’s search document. Pause, resume, cancel, batch, retry-failed, validate, and reindex require `confirm: true`.

A batch accepts 1 to 25 external ids and only queues them. Metrics are counts and timings from `ingestion_jobs`. They are not product analytics events.

## Security

Ingestion routes are behind `requireAdmin`. A job body accepts a known source slug and an external id, not an arbitrary URL. Server-side URL checks require HTTPS, reject credentials, and reject localhost, loopback, link-local, and private addresses. Redirects are not followed. Provider secrets are not returned by the admin API.
