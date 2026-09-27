import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError } from '../../../../../lib/api/client';
import { getSeason } from '../../../../../lib/api/catalog';
import { Artwork } from '../../../../../components/movies/artwork';
import { StatusPanel } from '../../../../../components/movies/status-panel';

function pageNumber(value) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export async function generateMetadata({ params }) {
  const { slug, number } = await params;
  return {
    title: `Season ${number}`,
    alternates: { canonical: `/show/${slug}/season/${number}` },
    robots: { index: false, follow: true },
  };
}

export default async function SeasonPage({ params, searchParams }) {
  const { slug, number } = await params;
  const query = await searchParams;
  const page = pageNumber(query.page);
  try {
    const result = await getSeason(slug, number, { page, limit: 24 });
    return (
      <main className="page-wrap py-8 md:py-12">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-honey">
          <Link href={`/show/${result.series.slug}`} className="text-honey">{result.series.title}</Link>
          <span> · Series</span>
        </p>
        <h1 className="mt-3 text-4xl font-semibold text-ink">{result.season.title}</h1>
        {result.season.synopsis ? <p className="mt-3 max-w-2xl text-sm text-muted">{result.season.synopsis}</p> : null}
        {result.data.length === 0 ? (
          <p className="mt-8 text-sm text-muted">No episodes are listed in this season.</p>
        ) : (
          <ol className="mt-8 space-y-4" aria-label="Episodes">
            {result.data.map((episode) => (
              <li key={episode.number}>
                <Link href={episode.href} className="grid min-h-11 grid-cols-[96px_minmax(0,1fr)] gap-4 bg-surface p-3">
                  <Artwork src={episode.thumbnailUrl} alt="" />
                  <span>
                    <span className="block text-sm font-medium text-ink">Episode {episode.number} · {episode.title}</span>
                    {episode.runtimeMinutes ? <span className="mt-1 block text-xs text-muted">{episode.runtimeMinutes} min</span> : null}
                    {episode.synopsis ? <span className="mt-2 block text-sm text-muted">{episode.synopsis}</span> : null}
                    <span className="mt-2 block text-xs uppercase tracking-[0.14em] text-muted">
                      {episode.mediaState?.state === 'MEDIA_AVAILABLE' ? 'Available' : episode.mediaState?.state === 'MEDIA_PENDING' ? 'Pending' : episode.mediaState?.state === 'PROVIDER_ERROR' ? 'Provider error' : episode.mediaState?.state === 'REVIEW_REQUIRED' ? 'Review required' : 'Unavailable'}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
        {result.pagination.totalPages > 1 ? (
          <nav className="mt-8 flex gap-4 text-sm" aria-label="Episode pages">
            {page > 1 ? <Link href={`/show/${slug}/season/${number}?page=${page - 1}`} className="min-h-11 text-honey">Previous</Link> : null}
            <span className="text-muted">Page {page} of {result.pagination.totalPages}</span>
            {page < result.pagination.totalPages ? <Link href={`/show/${slug}/season/${number}?page=${page + 1}`} className="min-h-11 text-honey">Next</Link> : null}
          </nav>
        ) : null}
      </main>
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return <StatusPanel title="This season is unavailable" body="BeezMovies could not load this season." />;
  }
}
