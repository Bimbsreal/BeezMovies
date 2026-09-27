# Production catalog seeding

This process does not publish a production catalog. The only approved metadata source in this workspace is `development-metadata`. It is an in-process adapter. It has no remote API, no credentials, and no movie files.

## Source

| Item | Value |
| --- | --- |
| Provider | Development metadata |
| Endpoint | Adapter methods `listPage`, `searchTitles`, `getMovie`, `getCredits`, `getImages`, `getExternalIdentifiers` |
| Authentication | none |
| Rate limit | 30 requests per minute, concurrency 2, stored on `catalog_source_runtime` |
| Fields | title, original title, synopsis, release date, runtime, language, country, genres, credits, images, external ids |
| Attribution | `development-metadata` |
| Artwork hosts | `images.example.com`, `videos.example.com` |
| Terms | Local development samples only. Do not treat example.com references as production media. |

Discovery returns the adapter's approved id list. That list currently contains two records: Nosferatu and Metropolis. Other adapter fixtures exist for tests and are not part of discovery. No additional titles were added.

## Pipeline

Approved source, then a dry-run page, then normalization, validation, and duplicate detection. A dry run does not write movies, media references, or search documents. Publication stays on the existing ingestion upsert, which keeps incomplete records as drafts and publishes a new record only when the quality gate is empty. Metadata and download availability stay separate. A seeded movie does not receive a media reference from this process.

## Batching and checkpoints

`POST /api/v1/admin/ingestion/bootstrap/dry-run` opens a `dry_run` with a batch size from 1 to 25. Each advance reads `listPage` from the stored cursor, classifies that page, then saves the next cursor and a batch row. Pause, resume, cancel, and retry keep that cursor. A paused run rejects another advance. One bad record is counted as invalid or failed and does not stop the rest of the page.

## Validation and duplicates

External ids are checked first, then the existing conservative title, year, director, and runtime match. A high-confidence match is a duplicate and is not inserted again. An ambiguous match is review. Missing title, release, synopsis, genre, poster, or external id is incomplete. Malformed metadata is invalid. Only a valid, non-duplicate, non-review record is counted as approved. Approved still means "eligible", not "published". The dry run's published count stays 0.

## Approval and publication

`POST /api/v1/admin/ingestion/bootstrap/apply` always returns `SEED_BLOCKED` until a verified backup is recorded. This phase does not run that publication. Cache invalidation and per-movie search events remain the existing ingestion behavior and are not invoked by the dry run.

## Rollback

Dry-run rows live in `catalog_seed_runs` and `catalog_seed_batches`, identified by run id, source, and timestamp. Cancelling a run does not delete movies. Do not clear the catalog to undo a batch.

## Monitoring

`/admin/ingestion/bootstrap` shows discovered, processed, valid, invalid, duplicates, review, approved, published, failed, progress, checkpoint, and remaining records. It does not estimate a catalog size beyond the source page total.
