export function releaseYear(movie) {
  if (!movie) return null;
  if (movie.releaseYear) return String(movie.releaseYear);
  if (movie.releaseDate) return String(movie.releaseDate).slice(0, 4);
  return null;
}

export function runtimeLabel(minutes) {
  if (!minutes) return null;
  return `${minutes} min`;
}

export function backdropUrl(movie) {
  const images = movie?.images || [];
  return images.find((image) => image.type === 'backdrop')?.url || movie?.poster?.url || null;
}

const TRAILER_HOSTS = new Set(['videos.example.com']);
const QUALITY_RANK = { '2160p': 4, '1080p': 3, '720p': 2, '480p': 1 };

export function isPlayablePreview(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:'
      && !parsed.username
      && !parsed.password
      && /\.(mp4|webm|ogg)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function trustedTrailerUrl(url) {
  if (!isPlayablePreview(url)) return null;
  try {
    const parsed = new URL(url);
    if (!TRAILER_HOSTS.has(parsed.hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function previewUrl(movie) {
  const trailer = (movie?.trailers || []).find((video) => video.type === 'trailer' && video.url);
  if (!trailer) return null;
  return trustedTrailerUrl(trailer.url);
}

export function confirmedQuality(movie) {
  const labels = (movie?.media || [])
    .filter((item) => item.availability === 'available' && QUALITY_RANK[item.quality])
    .map((item) => item.quality);
  labels.sort((left, right) => QUALITY_RANK[right] - QUALITY_RANK[left]);
  return labels[0] || null;
}

export function canRequestDownload(movie) {
  if (movie?.contentType?.code && movie.contentType.code !== 'movie') return false;
  if (movie?.mediaState?.state) return movie.mediaState.state === 'MEDIA_AVAILABLE';
  return (movie?.media || []).some((item) => (
    item.mediaType === 'download' && item.availability === 'available'
  ));
}

export function mediaAvailabilityLabel(movie) {
  const labels = {
    MEDIA_AVAILABLE: 'Movie media available',
    MEDIA_UNAVAILABLE: 'Download unavailable',
    MEDIA_PENDING: 'Download pending',
    PROVIDER_ERROR: 'Provider temporarily unavailable',
    REVIEW_REQUIRED: 'Review required',
  };
  return labels[movie?.mediaState?.state] || (canRequestDownload(movie) ? 'Movie media available' : 'Download unavailable');
}

export function jsonLd(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
