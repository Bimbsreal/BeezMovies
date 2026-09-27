import Link from 'next/link';
import { getCollections } from '../../lib/api/catalog';
import { StatusPanel } from '../../components/movies/status-panel';

export const metadata = {
  title: 'Collections',
  description: 'Browse BeezMovies collections.',
  alternates: { canonical: '/collections' },
};

export default async function CollectionsPage() {
  try {
    const collections = (await getCollections()).data || [];
    return (
      <div className="page-wrap py-8 md:py-12">
        <h1 className="text-4xl font-semibold tracking-tight text-ink">Collections</h1>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {collections.map((collection) => (
            <li key={collection.slug}>
              <Link href={`/collection/${collection.slug}`} className="block bg-surface p-5">
                <h2 className="text-xl font-semibold text-ink">{collection.name}</h2>
                {collection.description ? <p className="mt-2 text-sm text-muted">{collection.description}</p> : null}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  } catch {
    return <StatusPanel title="Collections are unavailable" body="BeezMovies could not load collections." />;
  }
}
