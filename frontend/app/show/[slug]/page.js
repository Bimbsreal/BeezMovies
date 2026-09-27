import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError } from '../../../lib/api/client';
import { getShow } from '../../../lib/api/catalog';
import { Artwork } from '../../../components/movies/artwork';
import { StatusPanel } from '../../../components/movies/status-panel';
import { jsonLd } from '../../../lib/catalog/present';

async function load(slug) {
  try {
    return (await getShow(slug)).data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const series = await load(slug);
  if (!series) return { title: 'Series', robots: { index: false, follow: false } };
  return {
    title: `${series.title} · Series`,
    description: series.synopsis || `${series.title} on BeezMovies.`,
    alternates: { canonical: `/show/${series.slug}` },
    robots: { index: true, follow: true },
  };
}

export default async function ShowPage({ params }) {
  const { slug } = await params;
  let series;
  try {
    series = await load(slug);
  } catch {
    return <StatusPanel title="This series is unavailable" body="BeezMovies could not load this series." />;
  }
  if (!series) notFound();
  const cast = (series.credits || []).filter((credit) => credit.department === 'Acting');
  const crew = (series.credits || []).filter((credit) => credit.department !== 'Acting');
  const structured = {
    '@context': 'https://schema.org',
    '@type': 'TVSeries',
    name: series.title,
    description: series.synopsis || undefined,
    url: `/show/${series.slug}`,
  };
  return (
    <main className="pb-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(structured) }} />
      <section className="relative min-h-[70vh] overflow-hidden bg-obsidian">
        {series.backdropUrl ? (
          <Artwork src={series.backdropUrl} alt="" priority className="absolute inset-0 h-full w-full object-cover" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-obsidian via-obsidian/80 to-obsidian/25" />
        <div className="page-wrap relative grid gap-6 pb-10 pt-16 md:grid-cols-[200px_minmax(0,1fr)] md:items-end">
          <div className="aspect-[2/3] w-32 overflow-hidden bg-surface md:w-full">
            <Artwork src={series.poster?.url} alt={series.poster?.url ? `${series.title} poster` : ''} priority />
          </div>
          <div className="max-w-3xl">
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-honey">Series</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">{series.title}</h1>
            {series.originalTitle && series.originalTitle !== series.title ? (
              <p className="mt-2 text-sm text-muted">{series.originalTitle}</p>
            ) : null}
            <p className="mt-4 text-sm text-ink/90">
              {[series.releaseYear, series.originalLanguage?.name].filter(Boolean).join(' · ')}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(series.industryLabels || []).map((item) => (
                <Link key={item.href} href={item.href} className="inline-flex min-h-11 items-center text-sm text-honey">{item.label}</Link>
              ))}
              {(series.countries || []).map((country) => (
                <Link key={country.slug} href={`/series/${country.slug}`} className="inline-flex min-h-11 items-center text-sm text-ink">{country.displayName} series</Link>
              ))}
              {(series.genres || []).map((genre) => (
                <Link key={genre.slug} href={series.industryLabels?.[0] ? `${series.industryLabels[0].href}?genre=${genre.slug}` : `/genre/${genre.slug}`} className="inline-flex min-h-11 items-center text-sm text-muted">{genre.name}</Link>
              ))}
            </div>
            {series.synopsis ? <p className="mt-4 max-w-2xl text-sm leading-relaxed text-ink">{series.synopsis}</p> : null}
          </div>
        </div>
      </section>
      <div className="page-wrap py-8">
        <h2 className="text-lg font-semibold text-ink">Seasons</h2>
        {series.seasons.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No seasons are listed for this series.</p>
        ) : (
          <ul className="mt-4 flex gap-2 overflow-x-auto" aria-label="Seasons">
            {series.seasons.map((season) => (
              <li key={season.number}>
                <Link href={season.href} className="inline-flex min-h-11 items-center bg-elevated px-4 text-sm text-ink">
                  {season.title}
                  <span className="ml-2 text-muted">{season.episodeCount}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {cast.length > 0 ? (
          <section className="mt-10" aria-labelledby="series-cast">
            <h2 id="series-cast" className="text-lg font-semibold text-ink">Cast</h2>
            <ul className="mt-3 space-y-1 text-sm text-muted">
              {cast.map((person) => <li key={`${person.name}-${person.characterName}`}>{person.name}{person.characterName ? ` · ${person.characterName}` : ''}</li>)}
            </ul>
          </section>
        ) : null}
        {crew.length > 0 ? (
          <section className="mt-8" aria-labelledby="series-crew">
            <h2 id="series-crew" className="text-lg font-semibold text-ink">Crew</h2>
            <ul className="mt-3 space-y-1 text-sm text-muted">
              {crew.map((person) => <li key={`${person.name}-${person.job}`}>{person.name} · {person.job}</li>)}
            </ul>
          </section>
        ) : null}
        <section className="mt-10" aria-labelledby="related-series">
          <h2 id="related-series" className="text-lg font-semibold text-ink">Related series</h2>
          {series.related.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No related series are listed.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {series.related.map((item) => (
                <li key={item.slug}><Link href={item.href} className="text-honey">{item.title} · Series</Link></li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
