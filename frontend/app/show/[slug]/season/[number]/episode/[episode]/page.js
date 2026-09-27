import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError } from '../../../../../../../lib/api/client';
import { getEpisode } from '../../../../../../../lib/api/catalog';
import { DownloadButton } from '../../../../../../../components/movies/download-button';
import { StatusPanel } from '../../../../../../../components/movies/status-panel';
import { jsonLd, mediaAvailabilityLabel } from '../../../../../../../lib/catalog/present';

const AVAILABILITY = {
  MEDIA_AVAILABLE: 'Available',
  MEDIA_UNAVAILABLE: 'Unavailable',
  MEDIA_PENDING: 'Pending',
  PROVIDER_ERROR: 'Provider error',
  REVIEW_REQUIRED: 'Review required',
};

export async function generateMetadata({ params }) {
  const { slug, number, episode } = await params;
  return {
    title: `Episode ${episode}`,
    alternates: { canonical: `/show/${slug}/season/${number}/episode/${episode}` },
    robots: { index: false, follow: true },
  };
}

export default async function EpisodePage({ params }) {
  const { slug, number, episode } = await params;
  try {
    const data = (await getEpisode(slug, number, episode)).data;
    const available = data.episode.mediaState.state === 'MEDIA_AVAILABLE';
    const structured = {
      '@context': 'https://schema.org',
      '@type': 'TVEpisode',
      name: data.episode.title,
      episodeNumber: data.episode.number,
      partOfSeason: { '@type': 'TVSeason', seasonNumber: data.season.number },
      partOfSeries: { '@type': 'TVSeries', name: data.series.title },
    };
    return (
      <main className="page-wrap py-8 md:py-12">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(structured) }} />
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-honey">
          <Link href={data.series.href}>{data.series.title}</Link>
          <span> · Series · </span>
          <Link href={data.season.href}>{data.season.title}</Link>
        </p>
        <h1 className="mt-3 text-4xl font-semibold text-ink">Episode {data.episode.number} · {data.episode.title}</h1>
        <p className="mt-3 text-sm text-muted">
          {[data.episode.runtimeMinutes ? `${data.episode.runtimeMinutes} min` : null, data.episode.releaseDate].filter(Boolean).join(' · ')}
        </p>
        <p className="mt-2 text-sm text-ink">{AVAILABILITY[data.episode.mediaState.state] || mediaAvailabilityLabel({ mediaState: data.episode.mediaState })}</p>
        {data.episode.synopsis ? <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink">{data.episode.synopsis}</p> : null}
        <p className="mt-6 text-sm text-muted">Trailer unavailable</p>
        <div className="mt-4">
          <DownloadButton slug={slug} season={number} episode={episode} available={available} />
        </div>
        <nav className="mt-8 flex flex-wrap gap-4 text-sm" aria-label="Episode navigation">
          {data.previous ? <Link href={data.previous.href} className="min-h-11 text-honey">Previous episode · {data.previous.title}</Link> : null}
          {data.next ? <Link href={data.next.href} className="min-h-11 text-honey">Next episode · {data.next.title}</Link> : null}
        </nav>
      </main>
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return <StatusPanel title="This episode is unavailable" body="BeezMovies could not load this episode." />;
  }
}
