import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ApiError } from '../../../lib/api/client';
import { getMovieBySlug, getRelatedMovies } from '../../../lib/api/catalog';
import { DetailRecommendation } from '../../../components/monetization/sponsored-content';
import { RecordView } from '../../../components/account/record-view';
import { LibraryActions } from '../../../components/account/library-actions';
import { Artwork } from '../../../components/movies/artwork';
import { DownloadButton } from '../../../components/movies/download-button';
import { MovieCard } from '../../../components/movies/movie-card';
import { PreviewButton } from '../../../components/movies/preview-button';
import { Rail } from '../../../components/movies/rail';
import { StatusPanel } from '../../../components/movies/status-panel';
import {
  backdropUrl,
  canRequestDownload,
  mediaAvailabilityLabel,
  confirmedQuality,
  jsonLd,
  previewUrl,
  releaseYear,
  runtimeLabel,
} from '../../../lib/catalog/present';
import { publicConfig } from '../../../lib/config';

async function loadMovie(slug) {
  try {
    return (await getMovieBySlug(slug)).data;
  } catch (error) {
    if (error instanceof ApiError && error.code === 'SLUG_MOVED' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(error.details?.slug || '')) {
      redirect(`/movie/${error.details.slug}`);
    }
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  try {
    const movie = await loadMovie(slug);
    if (!movie) return { title: 'Movie unavailable', robots: { index: false, follow: false } };
    const description = movie.synopsis || movie.tagline || `${movie.title} on BeezMovies.`;
    const image = movie.poster?.url || backdropUrl(movie);
    return {
      title: movie.title,
      description,
      alternates: { canonical: `/movie/${movie.slug}` },
      openGraph: {
        title: movie.title,
        description,
        url: `/movie/${movie.slug}`,
        type: 'video.movie',
        images: image ? [{ url: image }] : undefined,
      },
    };
  } catch {
    return { title: 'Movie unavailable', robots: { index: false, follow: false } };
  }
}

export default async function MoviePage({ params }) {
  const { slug } = await params;
  let movie;
  try {
    movie = await loadMovie(slug);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'MAINTENANCE') {
      return <StatusPanel title="BeezMovies is briefly offline" body={error.message} />;
    }
    return <StatusPanel title="This title is unavailable" body="BeezMovies could not load this movie." />;
  }
  if (!movie) notFound();

  const year = releaseYear(movie);
  const trailer = previewUrl(movie);
  const quality = confirmedQuality(movie);
  const cast = (movie.credits || []).filter((credit) => credit.department === 'Acting');
  const crew = (movie.credits || []).filter((credit) => credit.department !== 'Acting');
  let relatedRails = [];
  try {
    relatedRails = (await getRelatedMovies(movie.slug)).data || [];
  } catch {
    relatedRails = [];
  }
  const downloadable = canRequestDownload(movie);
  const directors = crew.filter((credit) => credit.job === 'Director');
  const structured = {
    '@context': 'https://schema.org',
    '@type': 'Movie',
    name: movie.title,
    description: movie.synopsis || undefined,
    datePublished: movie.releaseDate || undefined,
    image: movie.poster?.url || undefined,
    duration: movie.runtimeMinutes ? `PT${movie.runtimeMinutes}M` : undefined,
    genre: (movie.genres || []).map((genre) => genre.name),
    ...(movie.originalLanguage?.name ? { inLanguage: movie.originalLanguage.name } : {}),
    ...((movie.countries || []).length ? {
      countryOfOrigin: movie.countries.map((country) => ({
        '@type': 'Country',
        name: country.displayName || country.name,
      })),
    } : {}),
    ...(cast.length ? { actor: cast.map((credit) => ({ '@type': 'Person', name: credit.name })) } : {}),
    ...(directors.length ? { director: directors.map((credit) => ({ '@type': 'Person', name: credit.name })) } : {}),
    url: `${publicConfig.siteUrl}/movie/${movie.slug}`,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(structured) }} />
      <section className="relative min-h-[68vh] overflow-hidden bg-obsidian lg:min-h-[72vh]">
        <div className="absolute inset-0">
          <Artwork src={backdropUrl(movie)} alt="" priority />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-obsidian via-obsidian/80 to-obsidian/25" />
        <div className="page-wrap relative grid gap-6 pb-10 pt-16 sm:pt-20 md:grid-cols-[200px_minmax(0,1fr)] md:items-end md:pt-24 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]">
          <div className="aspect-[2/3] w-32 overflow-hidden bg-surface sm:w-40 md:w-full">
            <Artwork src={movie.poster?.url} alt={movie.poster?.url ? `${movie.title} poster` : ''} priority />
          </div>
          <div className="max-w-3xl self-end">
            <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl lg:text-6xl">{movie.title}</h1>
            {movie.originalTitle && movie.originalTitle !== movie.title ? (
              <p className="mt-2 text-sm text-muted">{movie.originalTitle}</p>
            ) : null}
            <p className="mt-4 text-sm text-ink/90">
              {[movie.contentType?.name, year, runtimeLabel(movie.runtimeMinutes), quality, movie.originalLanguage?.name].filter(Boolean).join(' · ')}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(movie.genres || []).map((genre) => (
                <Link key={genre.slug} href={`/genre/${genre.slug}`} className="inline-flex min-h-11 items-center text-sm text-honey">
                  {genre.name}
                </Link>
              ))}
              {(movie.languages || []).map((language) => (
                <Link key={language.code} href={`/languages/${language.code}`} className="inline-flex min-h-11 items-center text-sm text-muted" hrefLang={language.code}>
                  {language.name}
                </Link>
              ))}
              {(movie.industryLabels || []).map((item) => (
                <Link key={item.href} href={item.href} className="inline-flex min-h-11 items-center text-sm text-honey">
                  {item.label}
                </Link>
              ))}
              {(movie.countries || []).map((country) => (
                country.slug ? (
                  <Link key={country.slug} href={`/movies/${country.slug}`} className="inline-flex min-h-11 items-center text-sm text-ink">
                    {country.displayName || country.name}
                  </Link>
                ) : null
              ))}
            </div>
            {movie.synopsis ? <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink md:text-base">{movie.synopsis}</p> : null}
            {(movie.synopses || []).length > 0 ? (
              <div className="mt-3 space-y-2">
                {movie.synopses.map((item) => (
                  <p key={item.language.code} className="max-w-2xl text-sm leading-relaxed text-muted" lang={item.language.code}>
                    {item.language.name}: {item.text}
                  </p>
                ))}
              </div>
            ) : null}
            {(movie.alternateTitles || []).length > 0 ? (
              <p className="mt-3 text-sm text-muted">
                Also known as {movie.alternateTitles.map((item) => item.title).join(', ')}
              </p>
            ) : null}
            <div className="mt-6 flex flex-wrap items-start gap-3">
              {trailer ? (
                <PreviewButton src={trailer} title={movie.title} poster={backdropUrl(movie) || movie.poster?.url} analyticsSlug={movie.slug} />
              ) : (
                <p className="media-state media-state-muted" role="status">Trailer unavailable</p>
              )}
              <DownloadButton slug={movie.slug} available={canRequestDownload(movie)} prominent />
              <LibraryActions slug={movie.slug} />
            </div>
          </div>
        </div>
      </section>

      <section className="page-wrap pt-8" aria-labelledby="media-availability">
        <h2 id="media-availability" className="text-lg font-semibold text-ink">Availability</h2>
        <ul className="mt-4 space-y-2 text-sm">
          <li className="media-state media-state-muted" role="status">{trailer ? 'Trailer available' : 'Trailer unavailable'}</li>
          <li className="media-state media-state-muted" role="status">{mediaAvailabilityLabel(movie)}</li>
          <li className="media-state media-state-muted" role="status">
            {movie.mediaState?.countries?.length
              ? `Provider availability: ${movie.mediaState.countries.join(', ')}`
              : 'Country-specific availability is not supplied.'}
          </li>
        </ul>
      </section>

      <div className="page-wrap grid gap-10 py-8 lg:grid-cols-2">
        <section>
          <h2 className="text-lg font-semibold text-ink">Details</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <Detail term="Title" value={movie.title} />
            <Detail term="Original title" value={movie.originalTitle && movie.originalTitle !== movie.title ? movie.originalTitle : null} />
            <Detail term="Year" value={year} />
            <Detail term="Runtime" value={runtimeLabel(movie.runtimeMinutes)} />
            <Detail term="Genres">
              {(movie.genres || []).map((genre) => (
                <Link key={genre.slug} href={`/genre/${genre.slug}`} className="mr-3 inline-flex min-h-11 items-center text-honey">{genre.name}</Link>
              ))}
            </Detail>
            <Detail term="Languages">
              {(movie.languages || []).map((language) => (
                <Link key={language.code} href={`/languages/${language.code}`} className="mr-3 inline-flex min-h-11 items-center text-honey" hrefLang={language.code}>{language.name}</Link>
              ))}
            </Detail>
            <Detail term="Countries">
              {(movie.countries || []).filter((country) => country.slug).map((country) => (
                <Link key={country.slug} href={`/movies/${country.slug}`} className="mr-3 inline-flex min-h-11 items-center text-honey">{country.displayName || country.name}</Link>
              ))}
            </Detail>
            <Detail term="Quality" value={quality} />
            <Detail term="Synopsis" value={movie.synopsis} />
          </dl>
        </section>
        <section>
          <h2 className="text-lg font-semibold text-ink">Cast</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {cast.length === 0 ? <li className="text-muted">Cast is not listed.</li> : cast.map((credit) => (
              <li key={`${credit.personId}-${credit.characterName || credit.job}`}>
                <Link href={`/search?q=${encodeURIComponent(credit.name)}`} className="text-ink">{credit.name}</Link>
                {credit.characterName ? <span className="text-muted"> · {credit.characterName}</span> : null}
              </li>
            ))}
          </ul>
          <h2 className="mt-8 text-lg font-semibold text-ink">Crew</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {crew.length === 0 ? <li className="text-muted">Crew is not listed.</li> : crew.map((credit) => (
              <li key={`${credit.personId}-${credit.job}`}>
                <Link href={`/search?q=${encodeURIComponent(credit.name)}`} className="text-ink">{credit.name}</Link>
                <span className="text-muted"> · {credit.job}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {movie.collection ? (
        <section className="page-wrap pb-4">
          <h2 className="text-lg font-semibold text-ink">Collection</h2>
          <Link href={`/collection/${movie.collection.slug}`} className="mt-3 inline-block text-honey">
            {movie.collection.name}
          </Link>
        </section>
      ) : null}

      <DetailRecommendation />
      <RecordView slug={movie.slug} />

      {relatedRails.map((rail) => (
        <Rail key={rail.slug} title={rail.title} note={rail.reason} href={rail.href} analytics="rec:related">
          {rail.items.map((item) => <MovieCard key={item.slug} movie={item} />)}
        </Rail>
      ))}
    </>
  );
}

function Detail({ term, value, children }) {
  const body = children || value;
  if (!body || (Array.isArray(body) && body.length === 0)) return null;
  return (
    <div>
      <dt className="text-muted">{term}</dt>
      <dd className="text-ink">{body}</dd>
    </div>
  );
}
