import Link from 'next/link';
import { ApiError } from '../../lib/api/client';
import { getContentTypes, getCountries, getGenres, getMovies } from '../../lib/api/catalog';
import { searchMovies } from '../../lib/api/search';
import { MovieGrid } from '../../components/movies/movie-grid';
import { StatusPanel } from '../../components/movies/status-panel';
import { SearchLauncher } from '../../components/shell/search-launcher';

export const metadata = {
  title: 'Search',
  description: 'Search the BeezMovies catalog.',
  robots: { index: false, follow: false },
  alternates: { canonical: '/search' },
};

function pageNumber(value) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function searchHref({ q, genre, year, language, country, type, page }) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (genre) params.set('genre', genre);
  if (year) params.set('year', year);
  if (language) params.set('language', language);
  if (country) params.set('country', country);
  if (type) params.set('type', type);
  if (page > 1) params.set('page', String(page));
  const text = params.toString();
  return text ? `/search?${text}` : '/search';
}

export default async function SearchPage({ searchParams }) {
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q : '';
  const genre = typeof params.genre === 'string' ? params.genre : '';
  const year = typeof params.year === 'string' ? params.year : '';
  const language = typeof params.language === 'string' ? params.language : '';
  const country = typeof params.country === 'string' ? params.country : '';
  const type = typeof params.type === 'string' ? params.type : '';
  const page = pageNumber(params.page);
  let contentTypes = [];
  let genres = [];
  let countries = [];
  let languages = [];
  try {
    contentTypes = ((await getContentTypes()).data || []).filter((item) => item.active);
  } catch {
    contentTypes = [];
  }
  try {
    genres = (await getGenres()).data || [];
  } catch {
    genres = [];
  }
  try {
    countries = ((await getCountries()).data || []).filter((item) => item.movieCount > 0);
  } catch {
    countries = [];
  }
  try {
    const catalog = await getMovies({ limit: 50 });
    const seen = new Map();
    for (const movie of catalog.data || []) {
      if (movie.originalLanguage?.code) {
        seen.set(movie.originalLanguage.code, movie.originalLanguage.name || movie.originalLanguage.code);
      }
    }
    languages = [...seen.entries()].map(([code, name]) => ({ code, name }));
  } catch {
    languages = [];
  }

  let result = null;
  let failed = '';
  if (q.trim()) {
    try {
      result = await searchMovies({
        q: q.trim(),
        genre: genre || undefined,
        year: year || undefined,
        language: language || undefined,
        country: country || undefined,
        type: type || undefined,
        page,
        limit: 24,
      });
    } catch (error) {
      failed = error instanceof ApiError ? error.message : 'Search could not be completed.';
    }
  }

  const filters = { q, genre, year, language, country, type };
  const totalPages = result ? Math.max(1, Math.ceil(result.pagination.total / result.pagination.limit)) : 1;

  return (
    <div className="page-wrap py-8 md:py-10">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">Search</h1>
      <div className="mt-5 max-w-xl">
        <SearchLauncher initial={q} presentation="field" />
      </div>
      <form className="mt-4 grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap" action="/search">
        <input type="hidden" name="q" value={q} />
        <label className="text-xs uppercase tracking-[0.14em] text-muted">
          Type
          <select name="type" defaultValue={type} className="mt-1 block min-h-11 w-full bg-surface px-2 text-sm normal-case tracking-normal text-ink">
            <option value="">All</option>
            {contentTypes.map((item) => (
              <option key={item.code} value={item.code}>{item.pluralName}</option>
            ))}
          </select>
        </label>
        <label className="text-xs uppercase tracking-[0.14em] text-muted">
          Genre
          <select name="genre" defaultValue={genre} className="mt-1 block min-h-11 w-full bg-surface px-2 text-sm normal-case tracking-normal text-ink">
            <option value="">Any</option>
            {genres.map((item) => (
              <option key={item.slug} value={item.slug}>{item.name}</option>
            ))}
          </select>
        </label>
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
        {countries.length > 0 ? (
          <label className="text-xs uppercase tracking-[0.14em] text-muted">
            Country
            <select name="country" defaultValue={country} className="mt-1 block min-h-11 w-full bg-surface px-2 text-sm normal-case tracking-normal text-ink">
              <option value="">All countries</option>
              {countries.map((item) => (
                <option key={item.code} value={item.code}>{item.displayName}</option>
              ))}
            </select>
          </label>
        ) : null}
        {languages.length > 0 ? (
          <label className="text-xs uppercase tracking-[0.14em] text-muted">
            Language
            <select name="language" defaultValue={language} className="mt-1 block min-h-11 w-full bg-surface px-2 text-sm normal-case tracking-normal text-ink">
              <option value="">Any</option>
              {languages.map((item) => (
                <option key={item.code} value={item.code}>{item.name}</option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="submit" className="col-span-2 min-h-11 bg-elevated px-4 text-sm text-ink sm:col-span-1">Apply</button>
      </form>
      {genre || year || language || country || type ? (
        <p className="mt-3 text-sm">
          <Link href={searchHref({ q })} className="text-honey">Clear filters</Link>
        </p>
      ) : null}

      {!q.trim() ? <p className="mt-8 text-muted">Search the catalog by title, person, or genre.</p> : null}
      {failed ? <StatusPanel title="Search is unavailable" body={failed} /> : null}
      {result ? (
        <div className="mt-8">
          <p className="text-sm text-muted">
            {result.pagination.total} results
            <span> · Sorted by relevance</span>
          </p>
          {result.data.length === 0 ? (
            <div className="mt-6">
              <p className="text-ink">No matching titles.</p>
              {result.didYouMean?.length > 0 ? (
                <ul className="mt-4 space-y-2">
                  {result.didYouMean.map((item) => (
                    <li key={item.slug}>
                      <Link href={`/movie/${item.slug}`} className="text-honey">Did you mean {item.label}?</Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <div className="mt-6">
              <MovieGrid movies={result.data} />
            </div>
          )}
          {result.episodes?.length ? (
            <section className="mt-8" aria-labelledby="episode-hits">
              <h2 id="episode-hits" className="text-lg font-semibold text-ink">Seasons and episodes</h2>
              <ul className="mt-3 space-y-2">
                {result.episodes.map((item) => (
                  <li key={`${item.kind}-${item.href}`}>
                    <Link href={item.href} className="inline-flex min-h-11 items-center text-sm text-honey">
                      {item.kind === 'episode' ? 'Episode' : 'Season'} · {item.series} · {item.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {totalPages > 1 ? (
            <nav className="mt-8 flex items-center gap-4 text-sm" aria-label="Search pages">
              {page > 1 ? <Link href={searchHref({ ...filters, page: page - 1 })} className="min-h-11 text-honey">Previous</Link> : null}
              <span className="text-muted">Page {page} of {totalPages}</span>
              {page < totalPages ? <Link href={searchHref({ ...filters, page: page + 1 })} className="min-h-11 text-honey">Next</Link> : null}
            </nav>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
