import Link from 'next/link';
import { getCountries } from '../../lib/api/catalog';
import { StatusPanel } from '../../components/movies/status-panel';

export const metadata = {
  title: 'Countries',
  description: 'Browse BeezMovies by country.',
  alternates: { canonical: '/countries' },
};

const REGION_ORDER = [
  'Africa',
  'Europe',
  'North America',
  'South America',
  'Asia',
  'Oceania',
  'Middle East',
];

export default async function CountriesPage() {
  try {
    const body = await getCountries();
    const countries = body.data || [];
    const regions = REGION_ORDER
      .map((region) => ({
        region,
        countries: countries.filter((item) => item.region === region),
      }))
      .filter((group) => group.countries.length > 0);
    return (
      <div className="page-wrap py-8 md:py-12">
        <h1 className="text-4xl font-semibold tracking-tight text-ink">Countries</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted">
          Counts are published movies linked to each country. A country stays listed when the catalog does not have a title for it yet.
        </p>
        <div className="mt-8 space-y-8">
          {regions.map((group) => (
            <section key={group.region} aria-labelledby={`region-${group.region}`}>
              <h2 id={`region-${group.region}`} className="text-xs font-medium uppercase tracking-[0.22em] text-honey">
                {group.region}
              </h2>
              <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {group.countries.map((country) => (
                  <li key={country.slug}>
                    <Link href={`/movies/${country.slug}`} className="flex min-h-24 flex-col justify-end bg-surface px-4 py-4">
                      <span className="text-lg font-medium text-ink">{country.displayName}</span>
                      <span className="mt-1 text-sm text-muted">{country.movieCount} {country.movieCount === 1 ? 'movie' : 'movies'}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    );
  } catch {
    return <StatusPanel title="Countries are unavailable" body="BeezMovies could not load countries." />;
  }
}
