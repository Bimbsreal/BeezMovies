import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ApiError } from '../../../lib/api/client';
import { getGenreMovies } from '../../../lib/api/catalog';
import { MovieGrid } from '../../../components/movies/movie-grid';
import { StatusPanel } from '../../../components/movies/status-panel';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  try {
    const page = await getGenreMovies(slug, { limit: 1 });
    return {
      title: page.genre.name,
      description: `${page.genre.name} movies on BeezMovies.`,
      alternates: { canonical: `/genre/${page.genre.slug}` },
      openGraph: {
        title: page.genre.name,
        description: `${page.genre.name} movies on BeezMovies.`,
        url: `/genre/${page.genre.slug}`,
      },
    };
  } catch {
    return { title: 'Genre', robots: { index: false, follow: false } };
  }
}

export default async function GenrePage({ params, searchParams }) {
  const { slug } = await params;
  const query = await searchParams;
  const pageNumber = Number(query.page);
  const page = Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1;
  try {
    const result = await getGenreMovies(slug, { limit: 24, page });
    const totalPages = Math.max(1, Math.ceil(result.pagination.total / result.pagination.limit));
    return (
      <div className="page-wrap py-8 md:py-12">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-honey">Genre</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink">{result.genre.name}</h1>
        <p className="mt-2 text-sm text-muted">{result.pagination.total} titles</p>
        <div className="mt-8">
          {result.data.length === 0 ? (
            <p className="text-muted">No movies are listed in this genre yet.</p>
          ) : (
            <MovieGrid movies={result.data} />
          )}
        </div>
        {totalPages > 1 ? (
          <nav className="mt-8 flex items-center gap-4 text-sm" aria-label="Genre pages">
            {page > 1 ? <Link href={`/genre/${result.genre.slug}?page=${page - 1}`} className="min-h-11 text-honey">Previous</Link> : null}
            <span className="text-muted">Page {page} of {totalPages}</span>
            {page < totalPages ? <Link href={`/genre/${result.genre.slug}?page=${page + 1}`} className="min-h-11 text-honey">Next</Link> : null}
          </nav>
        ) : null}
      </div>
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return <StatusPanel title="This genre is unavailable" body="BeezMovies could not load this genre." />;
  }
}
