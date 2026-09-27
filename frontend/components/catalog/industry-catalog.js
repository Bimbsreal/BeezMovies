import Link from 'next/link';
import { MovieGrid } from '../movies/movie-grid';
import { StatusPanel } from '../movies/status-panel';

export function IndustryCatalog({ page, genre, year, pageNumber, hrefFor }) {
  const industry = page.industry;
  const heading = industry.label || industry.stem;
  const totalPages = Math.max(1, Math.ceil(page.pagination.total / page.pagination.limit));
  return (
    <div className="page-wrap py-8 md:py-12">
      <p className="text-xs font-medium uppercase tracking-[0.22em] text-honey">{industry.country.displayName}</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink">{heading}</h1>
      <p className="mt-3 max-w-2xl text-sm text-muted">
        {page.note || (page.pagination.total > 0
          ? `${page.pagination.total} published ${page.pagination.total === 1 ? 'title' : 'titles'}.`
          : `No published ${page.contentType?.pluralName?.toLowerCase() || 'titles'} are linked to ${industry.country.displayName} yet.`)}
      </p>
      {page.contentType ? (
        <p className="mt-2 text-sm text-muted">
          <Link href={`/movies/${industry.country.slug}`} className="text-honey">{industry.country.displayName}</Link>
          <span> · {page.contentType.name}</span>
        </p>
      ) : null}
      {(page.genres || []).length > 0 ? (
        <ul className="mt-4 flex flex-wrap gap-2" aria-label="Genres">
          {page.genres.map((item) => (
            <li key={item.slug}>
              <Link href={hrefFor({ genre: item.slug, year, page: 1 })} className="inline-flex min-h-11 items-center text-sm text-honey">
                {item.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-8">
        {page.data.length === 0 ? (
          <StatusPanel
            title={page.note ? 'Nothing is listed here' : `No ${heading} yet`}
            body={page.note || 'Titles appear here when a published record has this country and content type.'}
          />
        ) : (
          <MovieGrid movies={page.data} />
        )}
      </div>
      {totalPages > 1 ? (
        <nav className="mt-8 flex items-center gap-4 text-sm" aria-label="Pages">
          {pageNumber > 1 ? <Link href={hrefFor({ genre, year, page: pageNumber - 1 })} className="min-h-11 text-honey">Previous</Link> : null}
          <span className="text-muted">Page {pageNumber} of {totalPages}</span>
          {pageNumber < totalPages ? <Link href={hrefFor({ genre, year, page: pageNumber + 1 })} className="min-h-11 text-honey">Next</Link> : null}
        </nav>
      ) : null}
    </div>
  );
}
