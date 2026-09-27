import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError } from '../../../lib/api/client';
import { getCountry, getCountryMovies, getIndustry } from '../../../lib/api/catalog';
import { MovieGrid } from '../../../components/movies/movie-grid';
import { MovieCard } from '../../../components/movies/movie-card';
import { StatusPanel } from '../../../components/movies/status-panel';
import { IndustryCatalog } from '../../../components/catalog/industry-catalog';
import { jsonLd } from '../../../lib/catalog/present';

function countryDescription(country) {
  const count = `${country.movieCount} published ${country.movieCount === 1 ? 'movie' : 'movies'}`;
  const genres = (country.genres || []).map((item) => item.name);
  return genres.length ? `${count} in ${genres.join(', ')}.` : `${count}.`;
}

function pageNumber(value) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function hrefFor(slug, { genre, year, page }) {
  const params = new URLSearchParams();
  if (genre) params.set('genre', genre);
  if (year) params.set('year', year);
  if (page > 1) params.set('page', String(page));
  const text = params.toString();
  return text ? `/movies/${slug}?${text}` : `/movies/${slug}`;
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  try {
    const country = (await getCountry(slug)).data;
    const title = country.railTitle;
    const description = country.movieCount > 0
      ? countryDescription(country)
      : `No movies from ${country.displayName} are listed yet.`;
    return {
      title,
      description,
      alternates: { canonical: `/movies/${country.slug}` },
      robots: country.movieCount > 0 ? undefined : { index: false, follow: true },
      openGraph: {
        title,
        description,
        url: `/movies/${country.slug}`,
      },
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      try {
        const industry = await getIndustry(slug, { type: 'movie', limit: 1 });
        return {
          title: industry.industry?.label || 'Movies',
          description: industry.note || industry.industry?.label,
          alternates: { canonical: industry.canonicalPath || `/movies/${slug}` },
          robots: industry.indexable ? undefined : { index: false, follow: true },
        };
      } catch {
        return { title: 'Movies', robots: { index: false, follow: false } };
      }
    }
    return { title: 'Country', robots: { index: false, follow: false } };
  }
}

export default async function CountryMoviesPage({ params, searchParams }) {
  const { slug } = await params;
  const query = await searchParams;
  const genre = typeof query.genre === 'string' ? query.genre : '';
  const year = typeof query.year === 'string' ? query.year : '';
  const page = pageNumber(query.page);
  try {
    const result = await getCountryMovies(slug, {
      genre: genre || undefined,
      year: year || undefined,
      sort: 'popularity',
      order: 'desc',
      page,
      limit: 24,
    });
    let recent = [];
    if (!genre && !year && page === 1 && result.pagination.total > 0) {
      const added = await getCountryMovies(slug, { sort: 'created_at', order: 'desc', page: 1, limit: 12 });
      const popularSlugs = result.data.map((movie) => movie.slug).join('|');
      const recentSlugs = (added.data || []).map((movie) => movie.slug).join('|');
      recent = popularSlugs === recentSlugs ? [] : (added.data || []);
    }
    const country = result.country;
    const totalPages = Math.max(1, Math.ceil(result.pagination.total / result.pagination.limit));
    const structured = result.data.length === 0 ? null : {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: country.railTitle,
      url: `/movies/${country.slug}`,
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: result.pagination.total,
        itemListElement: result.data.map((movie, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: movie.title,
          url: `/movie/${movie.slug}`,
        })),
      },
    };
    return (
      <div className="page-wrap py-8 md:py-12">
        {structured ? (
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(structured) }} />
        ) : null}
        <p className="text-xs font-medium uppercase tracking-[0.22em] text-honey">{country.region}</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink">{country.railTitle}</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted">
          {country.movieCount > 0 ? countryDescription(country) : `No movies from ${country.displayName} are listed yet.`}
        </p>
        {(country.genres || []).length > 0 ? (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Genres in this country">
            {(country.genres || []).map((item) => (
              <li key={item.slug}>
                <Link
                  href={hrefFor(country.slug, { genre: item.slug, year, page: 1 })}
                  aria-current={genre === item.slug ? 'page' : undefined}
                  className={`inline-flex min-h-11 items-center px-3 text-sm ${genre === item.slug ? 'bg-honey text-obsidian' : 'bg-surface text-ink'}`}
                >
                  {item.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        <form className="mt-6 grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap" action={`/movies/${country.slug}`}>
          {(country.genres || []).length > 0 ? (
          <label className="text-xs uppercase tracking-[0.14em] text-muted">
            Genre
            <select name="genre" defaultValue={genre} className="mt-1 block min-h-11 w-full bg-surface px-2 text-sm normal-case tracking-normal text-ink">
              <option value="">Any</option>
              {(country.genres || []).map((item) => (
                <option key={item.slug} value={item.slug}>{item.name}</option>
              ))}
            </select>
          </label>
          ) : null}
          <label className="text-xs uppercase tracking-[0.14em] text-muted">
            Year
            <input
              name="year"
              defaultValue={year}
              inputMode="numeric"
              maxLength={4}
              className="mt-1 block min-h-11 w-full bg-surface px-2 text-sm text-ink sm:w-24"
            />
          </label>
          <button type="submit" className="col-span-2 min-h-11 bg-elevated px-4 text-sm text-ink sm:col-span-1">Apply</button>
        </form>
        {genre || year ? (
          <p className="mt-3 text-sm">
            <Link href={`/movies/${country.slug}`} className="text-honey">Clear filters</Link>
          </p>
        ) : null}
        {recent.length > 0 ? (
          <section className="mt-8" aria-labelledby="country-recent">
            <h2 id="country-recent" className="text-base font-semibold text-ink">Recently added</h2>
            <p className="mt-1 text-xs text-muted">Newest published movies from this country</p>
            <div className="rail-scroller mt-4">
              {recent.map((movie) => <MovieCard key={movie.slug} movie={movie} />)}
            </div>
          </section>
        ) : null}
        <div className="mt-8">
          {result.data.length === 0 ? (
            <StatusPanel
              title={country.movieCount === 0 ? `No movies from ${country.displayName} yet` : 'No matching movies'}
              body={country.movieCount === 0
                ? 'This country is part of the catalog. Titles appear here when a published movie is linked to it.'
                : 'No published movie matches this genre and year.'}
            />
          ) : (
            <>
              <h2 className="text-base font-semibold text-ink">Popular</h2>
              <p className="mt-1 text-xs text-muted">Ordered by editorial popularity</p>
              <div className="mt-4">
                <MovieGrid movies={result.data} />
              </div>
            </>
          )}
        </div>
        {totalPages > 1 ? (
          <nav className="mt-8 flex items-center gap-4 text-sm" aria-label="Country pages">
            {page > 1 ? <Link href={hrefFor(country.slug, { genre, year, page: page - 1 })} className="min-h-11 text-honey">Previous</Link> : null}
            <span className="text-muted">Page {page} of {totalPages}</span>
            {page < totalPages ? <Link href={hrefFor(country.slug, { genre, year, page: page + 1 })} className="min-h-11 text-honey">Next</Link> : null}
          </nav>
        ) : null}
      </div>
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      try {
        const industry = await getIndustry(slug, {
          type: 'movie',
          genre: genre || undefined,
          year: year || undefined,
          sort: 'popularity',
          order: 'desc',
          page,
          limit: 24,
        });
        return (
          <IndustryCatalog
            page={industry}
            genre={genre}
            year={year}
            pageNumber={page}
            hrefFor={(next) => hrefFor(slug, next)}
          />
        );
      } catch (industryError) {
        if (industryError instanceof ApiError && industryError.status === 404) notFound();
        return <StatusPanel title="This list is unavailable" body="BeezMovies could not load this classification." />;
      }
    }
    return <StatusPanel title="This country is unavailable" body="BeezMovies could not load this country." />;
  }
}
