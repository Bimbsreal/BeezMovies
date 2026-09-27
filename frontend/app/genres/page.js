import Link from 'next/link';
import { getGenres } from '../../lib/api/catalog';
import { StatusPanel } from '../../components/movies/status-panel';

export const metadata = {
  title: 'Genres',
  description: 'Browse BeezMovies by genre.',
  alternates: { canonical: '/genres' },
};

export default async function GenresPage() {
  try {
    const body = await getGenres();
    const genres = body.data || [];
    return (
      <div className="page-wrap py-8 md:py-12">
        <h1 className="text-4xl font-semibold tracking-tight text-ink">Genres</h1>
        <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {genres.map((genre) => (
            <li key={genre.slug}>
              <Link href={`/genre/${genre.slug}`} className="flex min-h-24 items-end bg-surface px-4 py-4 text-lg font-medium text-ink">
                {genre.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  } catch {
    return <StatusPanel title="Genres are unavailable" body="BeezMovies could not load genres." />;
  }
}
