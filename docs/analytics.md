# Analytics

Product analytics are separate from application logs, the security audit log, and the operational health checks. A failure in this layer does not stop browsing, search, or download resolution.

## Event taxonomy

Public clients may send only:

`PAGE_VIEW`, `MOVIE_VIEW`, `SEARCH_RESULT_CLICK`, `TRAILER_PLAY`, `PWA_INSTALL`, `PWA_OPEN`, `PWA_FAILURE`, `RAIL_IMPRESSION`, `RAIL_CLICK`, `RECOMMENDATION_IMPRESSION`, `RECOMMENDATION_CLICK`, `WEB_VITAL`.

The server records:

`SEARCH`, `DOWNLOAD_REQUEST`, `DOWNLOAD_RESOLVED`, `DOWNLOAD_FAILED`, `WATCHLIST_ADD`, `FAVORITE_ADD`, `API_LATENCY`, `ERROR`, `CATALOG_ADDED`, `CATALOG_PUBLISHED`, `CATALOG_ARCHIVED`.

Clients cannot submit download results, search counts, errors, or catalog changes. Unknown names are rejected. A repeated event id is stored once.

## What is collected

Events store a short subject such as a movie slug, rail name, status code, or normalized search text. Duration is stored for latency and web vitals. A session-only visitor key may be attached to a raw client event. It lives in `sessionStorage`, not a tracking cookie, and is never shown on a dashboard.

Authenticated watchlist and favorite adds are counted without the user id. Dashboards show aggregates only.

The collector does not send events from account, settings, or admin pages. It does not collect email, name, precise location, or a device fingerprint.

## Storage and pipeline

The browser or the API handler queues an event and returns. The write happens afterward.

```
Application
  -> in-process queue
  -> analytics processor
  -> daily rollup, search-term rollup, latency sample
```

Raw rows live in `analytics_events`. Dashboards read `analytics_daily`, `analytics_search_terms`, and `analytics_latency_samples`. They do not scan the raw table. No extra queue service is required at the current volume.

## Retention

| Data | Kept |
| --- | --- |
| Raw events and latency samples | 14 days |
| Search query text | 30 days |
| Daily aggregates | 400 days |
| Security audit log | Until an operator removes the account row that owns it |
| Application logs | The process log, not a product profile |

Older `search_query_stats` rows are removed after 30 days as well. Search text is not used to create movies.

## Dashboards

`/admin/analytics` shows overview, catalog, downloads, discovery, PWA, performance, and errors. Movie, search, and provider detail pages are linked from that screen. Periods are today, 7 days, 30 days, 90 days, and a custom range up to 90 days. Each report names its period and the previous period of the same length. A difference is not a cause.

Recommendation impressions are not treated as success. The click count is the useful figure.

Real-time API, database, worker, and cache state stays on `/admin/system`. This dashboard is historical.

## Export

Administrators can download a CSV of daily aggregates. The file has counts, subjects, and status codes. It has no visitor key, email, or password.

## Authorization

`/api/v1/admin/analytics` requires an admin session. Ordinary accounts receive 403. The public ingest route validates every field and ignores identities that the client tries to add.

## Failure

If the analytics database write fails, the API still answers the original page, search, or download. The ingest route answers 202 with `unavailable: true` instead of failing the visitor's action.
