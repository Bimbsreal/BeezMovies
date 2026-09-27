# Media experience

Trailers and downloads are separate. A movie page can show a still hero, a trailer, and an authorized download without mixing those actions.

## Trailer architecture

`movie_videos` stores a trailer reference. It does not store a video file. The public movie payload includes a trailer URL only when `publicTrailerUrl` accepts it:

- HTTPS, with no embedded username or password
- hostname `videos.example.com` until another authorized host is added in `backend/src/media/trailers.js` and `frontend/lib/catalog/present.js`
- path ending in `.mp4`, `.webm`, or `.ogg`

Any other reference, including the development seed URL for Nosferatu, is returned as `url: null`. The page then shows **Trailer unavailable** and keeps the backdrop and poster. It does not invent a play button.

When a URL passes, the movie page renders `PreviewButton`. The `<video>` element is created only after that button opens the dialog. `preload="none"` keeps the file from downloading with the page. The poster is the backdrop already shown on the page.

## Playback

The dialog is full screen on a narrow viewport and a centered panel from the `sm` breakpoint up. Native browser controls supply play, pause, seek, volume, captions, and fullscreen. A second row repeats play/pause, seek, volume, and fullscreen at a 44px minimum height so those actions are not hover-only.

Closing the dialog, or pressing Escape, pauses the element, leaves picture-in-picture if it was active, removes the source, and calls `load()`. Focus returns to the control that opened the dialog. `prefers-reduced-motion: reduce` skips the open fade and does not autoplay.

A playback failure replaces the video with **This trailer could not be played.** The browser's provider error text is not shown.

## Provider adapters

Trailer hosts are an allowlist, not a provider credential. Download resolution still uses the media-provider adapters in [media-providers.md](media-providers.md). Those adapters are not called by the trailer player. Provider API keys stay on the server.

## Advertising

`VIDEO_PRE_ROLL` can appear only inside the trailer dialog, before the video element is mounted. The visitor can continue to the trailer. The placement does not open a window, change the download button, or run during download resolution. Other placements stay in their existing slots. See [monetization.md](monetization.md).

## Download separation

Download stays on the movie page: **Download** calls `POST /api/v1/movies/:slug/download`. The trailer player sets `controlsList="nodownload"` and has no download action. An unavailable authorized file shows **Currently unavailable**, which is separate from **Trailer unavailable**.

## Quality

The page shows a quality token only when an available media reference stores `480p`, `720p`, `1080p`, or `2160p`. `2160p` is shown as `2160p`. The page does not rewrite it to 4K.

## Security

Public Open Graph and Movie structured data use the title, synopsis, canonical path, and poster or backdrop. They do not include trailer or provider URLs. The service worker does not cache video or caption requests.
