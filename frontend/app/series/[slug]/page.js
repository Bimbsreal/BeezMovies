import { notFound } from 'next/navigation';
import { ApiError } from '../../../lib/api/client';
import { getIndustry } from '../../../lib/api/catalog';
import { IndustryCatalog } from '../../../components/catalog/industry-catalog';
import { StatusPanel } from '../../../components/movies/status-panel';

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
  return text ? `/series/${slug}?${text}` : `/series/${slug}`;
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  try {
    const page = await getIndustry(slug, { type: 'series', limit: 1 });
    const title = page.industry?.label || `${page.industry?.stem || 'Series'} series are not listed`;
    return {
      title,
      description: page.note || title,
      alternates: { canonical: page.canonicalPath || `/series/${slug}` },
      robots: { index: false, follow: true },
    };
  } catch {
    return { title: 'Series', robots: { index: false, follow: false } };
  }
}

export default async function SeriesIndustryPage({ params, searchParams }) {
  const { slug } = await params;
  const query = await searchParams;
  const genre = typeof query.genre === 'string' ? query.genre : '';
  const year = typeof query.year === 'string' ? query.year : '';
  const page = pageNumber(query.page);
  try {
    const result = await getIndustry(slug, {
      type: 'series',
      genre: genre || undefined,
      year: year || undefined,
      page,
      limit: 24,
    });
    return (
      <IndustryCatalog
        page={result}
        genre={genre}
        year={year}
        pageNumber={page}
        hrefFor={(next) => hrefFor(slug, next)}
      />
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    return <StatusPanel title="This series list is unavailable" body="BeezMovies could not load this classification." />;
  }
}
