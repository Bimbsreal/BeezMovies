# Public movie experience

Anonymous visitors can browse, search, and open movie pages. Sign-in is optional and is not required to view a title or to request a download.

## Routes

| Path | Purpose |
| --- | --- |
| `/` | Hero and discovery rails |
| `/movies` | Catalog grid |
| `/movie/[slug]` | Movie detail, preview, download |
| `/movies/[slug]` | Redirects to `/movie/[slug]` |
| `/genres` and `/genre/[slug]` | Genre index and grid |
| `/collections` and `/collection/[slug]` | Collection index and ordered movies |
| `/search?q=` | Search results. Not indexed. |

Movie pages set a title, description, canonical URL, Open Graph fields, and Movie structured data. Account, sign-in, and search URLs stay out of the sitemap and `robots.txt`.

## Download

`POST /api/v1/movies/:slug/download` does not require a session. The body cannot contain a URL. The download resolution service checks the active movie, ranks authorized download references, and asks the enabled provider adapter to resolve one. The development adapter returns a short-lived same-origin handoff. The browser then requests `GET /api/v1/media/handoff/:token`, which serves a locally generated file. Provider tokens, remote URLs, and credentials are not returned.

The button labels are Download, Preparing download..., Download started, Download unavailable, and Try again. See [media-providers.md](media-providers.md).

Public movie detail no longer includes the provider reference string.

## Interface

The shell is a compact dark header with the official logo, Home, Movies, Genres, an expanding search control, and an optional account link. Mobile uses the logo, search, and a menu. Rails scroll sideways. Cards keep a poster ratio and show extra text on hover or keyboard focus. Motion is reduced when `prefers-reduced-motion` is set.

Empty artwork, missing titles, empty search, download failure, and offline navigation have their own messages. Hidden `data-placement` slots reserve future monetization space and do not render advertisements.

## PWA

The manifest name is BeezMovies, `display` is `standalone`, `start_url` is `/`, and both theme and background colors are `#0B0D0F`. Icons are the official artwork at the JPEG’s native size, plus 192 and 512 install icons and a maskable 512. Production installation needs HTTPS. Localhost is already a secure context, so the install criteria can be checked here without a deployment.

An installed launch (`display-mode: standalone`) plays a short CSS startup over the homepage. Local development can preview that sequence at `/?startup=1`. The query does nothing in a production build. The catalog request is not delayed by the animation. A later navigation in the same session does not replay it. A refresh in the installed app uses a short logo fade. A normal browser tab does not play the flight. `prefers-reduced-motion: reduce` skips the flight and uses that short fade. The overlay is hidden from assistive technology, ignores pointer events, and fades out even if the React timer never runs. There is no startup sound.

The service worker version is `beezmovies-static-v3`. It precaches the logo, the flight asset, the icons, the manifest, and `/offline.html`. It does not cache API responses, account pages, or search result URLs. It is registered in production builds. The startup sequence uses local branding files and does not call a media provider.
