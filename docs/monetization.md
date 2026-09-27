# Monetization

BeezMovies keeps advertising behind a server-controlled placement layer. The public catalog, search, and one-click download do not call this layer. A failed or missing placement collapses. It does not delay a download, open another tab, or show an error dialog.

## Placements

| Placement | Where it can appear |
| --- | --- |
| `VIDEO_PRE_ROLL` | Inside the trailer dialog, before the trailer, with an immediate continue control |
| `IN_FEED_NATIVE` | One labeled card in the homepage trending rail |
| `DESKTOP_SIDE_RAIL` | Fixed space in the right margin only when the viewport is at least 1800px wide |
| `MOVIE_DETAIL_RECOMMENDATION` | After movie metadata and before related titles |
| `FOOTER_NATIVE` | Under the existing footer |

`POPUNDER`, `FULLSCREEN_FORCED`, and `FAKE_DOWNLOAD` are not placement types. Mobile defaults are off. The side rail stays hidden on smaller screens even if an administrator enables the mobile flag.

Every visible creative says **Sponsored** or **Advertisement**, can be dismissed, and is ordinary page content. The client does not request notification permission.

## Providers

The registry lists ExoClick, HilltopAds, Infolinks, Adsterra, PropellerAds, Rapidgator, Katfile, and DoodStream as `documentation_required`. Enabling one of those providers does not load a script, zone, or affiliate URL. Public delivery stays `inactive` until that provider's official integration is verified and implemented.

`house` is the only provider with `integration_status = ready`. It serves text an administrator saved. It has no secret. Credentials for every other provider display as **Not configured**.

Geographic and device targeting for third-party networks display as **Unverified** until the official product documents that support. Desktop and mobile flags on a placement are enforced by BeezMovies itself.

## Frequency, consent, and events

Each placement has a frequency cap, a minimum interval, and a page limit. The defaults are one impression, one hour, and one impression per anonymous session. The session id is a random value in `sessionStorage`. It is not the account id and it is not a cross-site cookie.

`monetization_settings.consent_required` defaults to false. When an administrator turns it on, public placements are withheld until a future consent flow grants them. This build does not show a consent popup.

Impression, click, completion, and failure events are recorded only for an enabled, ready placement. Clients cannot submit revenue. Affiliate rows are an administrator record of a campaign and conversion reference. They do not redirect the visitor. Estimated revenue is **Not available** because no provider revenue API is connected.

## Admin

`/admin/monetization` can enable or disable a provider, enable or disable a placement, save a house creative, and read recorded events. Changes apply on the next config request without a deploy. Writes require `admin.catalog` and `confirm: true`.

## Download

`POST /api/v1/movies/:slug/download` does not read monetization tables. The download button does not import the monetization components.
