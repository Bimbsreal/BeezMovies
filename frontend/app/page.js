import Link from 'next/link';
import { getMovieBySlug } from '../lib/api/catalog';
import { ApiError } from '../lib/api/client';
import { getHome } from '../lib/api/search';
import { BecauseYouLike } from '../components/account/because-you-like';
import { BecauseYouViewed } from '../components/account/because-you-viewed';
import { InFeedSlot, SideRail } from '../components/monetization/sponsored-content';
import { Hero } from '../components/movies/hero';
import { MovieCard } from '../components/movies/movie-card';
import { PlacementSlot } from '../components/movies/status-panel';
import { Rail } from '../components/movies/rail';
import { StatusPanel } from '../components/movies/status-panel';

export const metadata = {
  title: 'BeezMovies',
  description: 'Browse the BeezMovies catalog.',
  alternates: { canonical: '/' },
};

function CountryExplore({ countries }) {
  if (!countries?.length) return null;
  return (
    <section className="page-wrap py-5 md:py-7" aria-labelledby="explore-countries">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 id="explore-countries" className="text-base font-semibold tracking-tight text-ink md:text-lg">Explore by country</h2>
        <Link href="/countries" className="text-xs font-medium uppercase tracking-[0.16em] text-honey">More countries</Link>
      </div>
      <ul className="flex gap-2 overflow-x-auto pb-2">
        {countries.map((country) => (
          <li key={country.slug} className="shrink-0">
            <Link
              href={`/movies/${country.slug}`}
              className="inline-flex min-h-11 items-center border border-white/15 bg-surface px-4 text-sm text-ink"
            >
              {country.displayName}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function loadHome() {
  const home = await getHome();
  const rails = home.data?.rails || [];
  const featuredSlug = home.data?.featured?.slug;
  const featured = featuredSlug ? (await getMovieBySlug(featuredSlug)).data : null;
  return { featured, rails, countries: home.data?.countries || [] };
}

export default async function HomePage() {
  try {
    const home = await loadHome();
    const sponsorSlug = home.rails.find((rail) => rail.kind === 'movies' && rail.items.length > 1)?.slug;
    return (
      <>
        {home.featured ? <Hero movie={home.featured} /> : (
          <StatusPanel
            title="The catalog is quiet"
            body="No movies are published yet."
          />
        )}
        <BecauseYouLike />
        <BecauseYouViewed />
        <PlacementSlot id="home-after-hero" />
        <CountryExplore countries={home.countries} />
        <SideRail />
        {home.rails.map((rail) => (
          rail.kind === 'collections' ? (
            <Rail key={rail.slug} title={rail.title} note={rail.reason} href={rail.href} analytics={`rail:${rail.source}`}>
              {rail.items.map((collection) => (
                <Link key={collection.slug} href={`/collection/${collection.slug}`} className="block w-56 shrink-0">
                  <div className="aspect-video bg-surface" />
                  <h3 className="mt-2 text-sm font-medium text-ink">{collection.name}</h3>
                  {collection.description ? (
                    <p className="mt-1 line-clamp-2 text-xs text-muted">{collection.description}</p>
                  ) : null}
                </Link>
              ))}
            </Rail>
          ) : (
            <Rail key={rail.slug} title={rail.title} note={rail.reason} href={rail.href} analytics={`rail:${rail.source}`}>
              {rail.items.flatMap((movie, index) => [
                <MovieCard key={movie.slug} movie={movie} />,
                rail.slug === sponsorSlug && index === 1 ? <InFeedSlot key="sponsored-in-feed" /> : null,
              ])}
            </Rail>
          )
        ))}
        <PlacementSlot id="home-after-rails" />
      </>
    );
  } catch (error) {
    if (error instanceof ApiError && error.code === 'MAINTENANCE') {
      return (
        <StatusPanel
          title="BeezMovies is briefly offline"
          body={error.message}
        />
      );
    }
    return (
      <StatusPanel
        title="The catalog is unavailable"
        body="BeezMovies could not load movies. Check the connection and try again."
      />
    );
  }
}
