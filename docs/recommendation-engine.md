# Recommendation engine

Homepage sections are configuration rows in `homepage_rails`. The catalog stays in `movies`. A rail stores a title, source, order, item limit, and cache window. It does not copy movie metadata.

## Signals

| Source | What it uses | Label |
| --- | --- | --- |
| `featured` | Non-null editorial `movies.popularity` | Featured. Reason: Editorial ranking. |
| `recent` | `movies.created_at` for active movies | Recently added. Reason: Newest published movies. |
| `trending` | Distinct signed-in members with a `user_recent_views` row in the last 14 days | Trending. The rail is omitted when nobody has that history. |
| `genres` | Active movies in each published genre | The genre name. |
| `collection` | Active movies in one collection, in the collection's sort order | The configured title. |
| `collections` | Collection records, not a repeated movie list | Collections. |

`updated_at` is not a publication time. A metadata refresh does not make a movie newly added.

`popularity` is an editorial score already stored on the movie. It is not a view count, so the homepage does not call that list Popular or Trending. Search still uses it only as a small tie-break, described in [search.md](search.md).

There is no machine-learning ranker. Nothing is labeled as an AI recommendation.

## Anonymous discovery

Anonymous visitors receive the public homepage from `GET /api/v1/discovery/home`. That response uses the signals above. It does not read a person's watchlist, favorites, or history. Trending, when present, is an aggregate of signed-in views and does not include user ids.

## Signed-in discovery

`GET /api/v1/me/suggestions` adds **Because you like {genre}** from that member's favorites, watchlist, recently viewed titles, and preferred genres. `GET /api/v1/me/continue` adds **Because you viewed {title}** from that member's latest viewed movie and the same related-movie rules. Both routes require the session cookie. One member cannot read another's lists.

Recently viewed history can be cleared in account settings.

## Related movies

`GET /api/v1/movies/:slug/related` scores other active movies with shared genres, the same original language, a release year within ten years, and membership in the same collection. The current movie is excluded. A score of zero is omitted. A second genre rail is omitted when it would repeat the first rail.

## Rails and caching

Rails render in `sort_order`. A movie rail with no items is hidden. A later rail is hidden when it repeats the same source and the same movie sequence. Featured and Recently added can both include a movie because the reasons differ. Movies are not invented to fill a gap.

The public homepage and related payload are cached for 60 seconds in process memory and, when Redis is available, under a generation key. Publishing, archiving, collection edits, and rail saves bump that generation. Other cache entries stay in place until they expire.

## Admin

`/admin/rails` requires `admin.catalog`. An administrator can change the title, order, item limit, and enabled flag. The source type stays fixed, so a rail cannot be pointed at an unpublished status. Every movie query keeps `status = active`.

## Privacy

The homepage does not collect location or a device id. Anonymous browsing does not write viewing history. Personalized routes are `Cache-Control: private, no-store`.
