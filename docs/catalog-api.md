# Catalog API

A machine-readable copy of these routes is `docs/catalog-api.openapi.yaml`.

PostgreSQL remains the source of truth. Routes validate input, controllers call the catalog service, and repositories run parameterized SQL. Responses are serialized and do not return database rows.

`GET /me/watchlist` is reserved. It will use `requireAuth` from the identity system. It is not implemented.

## Public endpoints

All of these are `GET` and do not require a session.

| Path | Purpose |
| --- | --- |
| `/api/v1/movies` | Paginated movie list |
| `/api/v1/movies/:slug` | Public movie detail |
| `/api/v1/genres` | Genre list, capped at 200 |
| `/api/v1/genres/:slug/movies` | Movies in one genre |
| `/api/v1/collections` | Collection list, capped at 200 |
| `/api/v1/collections/:slug` | Collection and movies ordered by `sort_order` |
| `/api/v1/people/:id` | Public person |
| `/api/v1/people/:id/movies` | Movies linked through credits |

`GET /api/v1/movies/id/:id` is an admin route. It uses the same movie assembly as the slug route and adds the movie id. A missing session is `401`. A signed-in user without `admin.access` is `403`.

## List parameters

| Parameter | Rule |
| --- | --- |
| `page` | Integer, 1 through 10000. Default 1. |
| `limit` | Integer, 1 through 50. Default 20. |
| `sort` | `release_date`, `title`, or `created_at`. Default `release_date`. |
| `order` | `asc` or `desc`. Default `desc`. |
| `status` | `active` for everyone. `draft` and `archived` require an admin. |
| `genre` | Genre slug. |
| `year` | Release year, 1888 through 2100. |
| `releasedFrom`, `releasedTo` | `YYYY-MM-DD`. `releasedFrom` must not be after `releasedTo`. |
| `language` | Spoken language or original language code. |
| `country` | Production country code. |
| `collection` | Collection slug. |
| `q` | Title or alternate-title text, at most 100 characters. |

Unknown `sort` values and out-of-range pages are `400`. Unknown slugs are `404`. Filter values are bound parameters. Sort columns come from a fixed map.

Public lists include only `active` movies. A draft slug returns `404` to anonymous and ordinary users.

## Response

Lists:

```json
{
  "data": [],
  "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

Movie detail is `{ "data": { ... } }`. Fields use camel case. The public movie object includes title, original title, synopsis, tagline, release date, runtime, status, genres, languages, countries, alternate titles, images, trailers, credits, collection, external identifiers, ratings, tags, and available media references. Available media lists the type, quality, and provider name. It does not include the provider reference token. `POST /api/v1/movies/:slug/download` resolves a download for anonymous visitors and is described in [public-experience.md](public-experience.md). `seo` carries `title`, `description`, `path`, and `image`. The public page canonical path is `/movie/:slug`.

The public movie object omits the movie UUID, provider configuration, image metadata blobs, and media references that are not `available`. Pending references stay out of the response.

Anonymous catalog responses send `Cache-Control: public, max-age=60`. A request that brings a session cookie sends `private, no-store`.

## Cache boundary

`backend/src/catalog/cache.js` is the only catalog cache client. It uses the existing Redis connection when that connection is ready, and it no-ops when Redis is down. Movie detail, the genre list, and the collection list may be stored for 60 seconds. `invalidateCatalogCache({ slug })` is the hook later ingestion will call. It does not run a distributed invalidation protocol.

## Indexes these queries are written for

- `movies_slug_key` for detail by slug.
- `idx_movies_status` and `idx_movies_active_release_date` for active lists.
- `idx_movies_release_year` and `idx_movies_canonical_title` for year and title ordering.
- `idx_movies_normalized_title` and `idx_alternate_titles_normalized_title` for later search. The `q` filter uses a parameterized `LIKE` around `catalog_normalize_text`, which does not use a btree index for a leading wildcard. A search engine is a later phase.
- `idx_movie_genres_genre_id`, `idx_movie_languages_language_id`, `idx_movie_countries_country_id`.
- `idx_collection_movies_sort` for collection order.
- `idx_movie_credits_person_id` for a person's films.

Movie detail loads related rows in a fixed batch of queries, not one query per credit or image.
