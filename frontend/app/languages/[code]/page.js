import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError } from '../../../lib/api/client';
import { getLanguageMovies } from '../../../lib/api/catalog';
import { MovieGrid } from '../../../components/movies/movie-grid';
import { StatusPanel } from '../../../components/movies/status-panel';

export async function generateMetadata({ params }) {
  const { code } = await params;
  try {
    const result = await getLanguageMovies(code, { limit: 1 });
    const title = `${result.language.name} movies`;
    const description = result.language.movieCount > 0
      ? `${result.language.movieCount} published movies include ${result.language.name}.`
      : `No published movies include ${result.language.name} yet.`;
    return {
      title,
      description,
      alternates: { canonical: `/languages/${result.language.code}` },
      robots: result.language.movieCount > 0 ? undefined : { index: false, follow: true },
      openGraph: { title, description, url: `/languages/${result.language.code}` },
    };
  } catch {
    return { title: 'Language', robots: { index: false, follow: false } };
  }
}

export default async function LanguageMoviesPage({ params, searchParams }) {
  const { code } = await params;
  const query = await searchParams;
  const pageNumber = Number(query.page);
  const page = Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 1;
  try {
    const result = await getLanguageMovies(code, { page, limit: 24, sort: 'popularity', order: 'desc' });
    const totalPages = Math.max(1, Math.ceil(result.pagination.total / result.pagination.limit));
    return (
      <div className="page-wrap py-8 md:py-12">
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-honey">Language</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink">{result.language.name} movies</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted">
          {result.pagination.total} published {result.pagination.total === 1 ? 'movie includes' : 'movies include'} {result.language.name}. This list is not a country.
        </p>
        <div className="mt-8">
          {result.data.length === 0 ? (
            <StatusPanel
              title={`No ${result.language.name} movies yet`}
              body="Movies appear here when their spoken language or original language is recorded."
            />
          ) : (
            <MovieGrid movies={result.data} />
          )}
        </div>
        {totalPages > 1 ? (
          <nav className="mt-8 flex items-center gap-4 text-sm" aria-label="Language pages">
            {page > 1 ? <Link href={`/languages/${result.language.code}?page=${page - 1}`} className="min-h-11 text-honey">Previous</Link> : null}
            <span className="text-muted">Page {page} of {totalPages}</span>
            {page < totalPages ? <Link href={`/languages/${result.language.code}?page=${page + 1}`} className="min-h-11 text-honey">Next</Link> : null}
          </nav>
        ) : null}
      </div>
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return <StatusPanel title="This language is unavailable" body="BeezMovies could not load this language." />;
  }
}
