import { notFound } from 'next/navigation';
import { ApiError } from '../../../lib/api/client';
import { getCollection } from '../../../lib/api/catalog';
import { Artwork } from '../../../components/movies/artwork';
import { MovieCard } from '../../../components/movies/movie-card';
import { StatusPanel } from '../../../components/movies/status-panel';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  try {
    const body = await getCollection(slug);
    return {
      title: body.data.name,
      description: body.data.description || `${body.data.name} on BeezMovies.`,
      alternates: { canonical: `/collection/${body.data.slug}` },
      openGraph: {
        title: body.data.name,
        description: body.data.description || undefined,
        images: body.data.posterUrl ? [{ url: body.data.posterUrl }] : undefined,
      },
    };
  } catch {
    return { title: 'Collection', robots: { index: false, follow: false } };
  }
}

export default async function CollectionPage({ params }) {
  const { slug } = await params;
  try {
    const collection = (await getCollection(slug)).data;
    const movies = [...(collection.movies || [])].sort((left, right) => (left.sortOrder || 0) - (right.sortOrder || 0));
    return (
      <div className="page-wrap py-8 md:py-12">
        <div className="grid gap-6 md:grid-cols-[280px_1fr] md:items-end">
          <div className="aspect-video overflow-hidden bg-surface">
            <Artwork src={collection.posterUrl} alt="" />
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-honey">Collection</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink">{collection.name}</h1>
            {collection.description ? <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">{collection.description}</p> : null}
          </div>
        </div>
        <ol className="mt-10 grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {movies.map((movie, index) => (
            <li key={movie.slug}>
              <p className="mb-2 text-xs text-muted">{index + 1}</p>
              <MovieCard movie={movie} />
            </li>
          ))}
        </ol>
      </div>
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return <StatusPanel title="This collection is unavailable" body="BeezMovies could not load this collection." />;
  }
}
