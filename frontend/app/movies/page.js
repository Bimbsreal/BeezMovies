import Link from 'next/link';
import { getMovies } from '../../lib/api/catalog';
import { MovieGrid } from '../../components/movies/movie-grid';
import { StatusPanel } from '../../components/movies/status-panel';

export const metadata = {
  title: 'Movies',
  description: 'Browse movies on BeezMovies.',
  alternates: { canonical: '/movies' },
};

const SORTS = [
  { label: 'Newest', sort: 'release_date', order: 'desc' },
  { label: 'Oldest', sort: 'release_date', order: 'asc' },
  { label: 'Title', sort: 'title', order: 'asc' },
  { label: 'Popular', sort: 'popularity', order: 'desc' },
  { label: 'Recently added', sort: 'created_at', order: 'desc' },
];

function sortHref(sort, order) {
  return `/movies?sort=${sort}&order=${order}`;
}

export default async function MoviesPage({ searchParams }) {
  const params = await searchParams;
  const sort = SORTS.some((item) => item.sort === params.sort && item.order === params.order)
    ? params.sort
    : 'release_date';
  const order = SORTS.some((item) => item.sort === sort && item.order === params.order)
    ? params.order
    : 'desc';

  try {
    const page = await getMovies({ sort, order, limit: 24, page: 1 });
    return (
      <div className="page-wrap py-8 md:py-10">
        <h1 className="text-3xl font-semibold tracking-tight text-ink md:text-4xl">Movies</h1>
        <p className="mt-2 text-sm text-muted">{page.pagination.total} titles</p>
        <div className="mt-5 flex flex-wrap gap-2" role="navigation" aria-label="Sort movies">
          {SORTS.map((item) => {
            const current = item.sort === sort && item.order === order;
            return (
              <Link
                key={`${item.sort}-${item.order}`}
                href={sortHref(item.sort, item.order)}
                aria-current={current ? 'true' : undefined}
                className={`min-h-11 px-3 py-2 text-sm ${current ? 'bg-elevated text-ink' : 'text-muted'}`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
        <div className="mt-6">
          <MovieGrid movies={page.data} />
        </div>
      </div>
    );
  } catch {
    return (
      <StatusPanel
        title="Movies are unavailable"
        body="BeezMovies could not load the catalog."
      />
    );
  }
}
