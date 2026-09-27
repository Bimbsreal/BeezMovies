'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';
import { MovieCard } from '../movies/movie-card';
import { AccountNav } from './account-nav';

function Shelf({ title, href, movies, empty }) {
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {href ? <Link href={href} className="text-sm text-honey">See all</Link> : null}
      </div>
      {movies.length === 0 ? <p className="mt-3 text-sm text-muted">{empty}</p> : (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {movies.map((movie) => (
            <li key={movie.slug}><MovieCard movie={movie} /></li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function AccountHome() {
  const { status, user } = useAuth();
  const [lists, setLists] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (status !== 'authenticated') return undefined;
    let active = true;
    Promise.all([
      api('/me/watchlist?limit=8'),
      api('/me/favorites?limit=8'),
      api('/me/recent?limit=8'),
      api('/me/suggestions'),
      api('/me/country-picks'),
      api('/me/progress'),
    ]).then(([watchlist, favorites, recent, suggestions, countries, progress]) => {
      if (!active) return;
      setLists({
        watchlist: watchlist.data || [],
        favorites: favorites.data || [],
        recent: recent.data || [],
        suggestions: suggestions.data,
        countries: countries.data,
        progress: progress.data,
      });
    }).catch(() => {
      if (active) setError('Your account could not be loaded.');
    });
    return () => {
      active = false;
    };
  }, [status]);

  if (status === 'loading' || (status === 'authenticated' && !lists && !error)) {
    return <p className="page-wrap py-16 text-sm text-muted">Checking your session…</p>;
  }

  if (status !== 'authenticated' || !user) {
    return (
      <section className="page-wrap py-16">
        <h1 className="text-4xl font-semibold tracking-tight text-ink">Account</h1>
        <p className="mt-3 max-w-xl text-muted">Sign in to keep a list. Browsing, trailers, and authorized downloads stay open without an account.</p>
        <Link href="/login" className="mt-6 inline-flex min-h-11 items-center text-honey">Sign in</Link>
      </section>
    );
  }

  return (
    <div className="page-wrap py-8 md:py-12">
      <p className="text-xs font-medium uppercase tracking-[0.22em] text-honey">Account</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink">{user.displayName}</h1>
      <p className="mt-2 text-sm text-muted">{user.email}</p>
      <div className="mt-6">
        <AccountNav />
      </div>
      {error ? <p className="text-sm text-honey" role="alert">{error}</p> : null}
      {lists ? (
        <>
          <section className="mt-8 max-w-2xl" aria-labelledby="continue-watching">
            <h2 id="continue-watching" className="text-lg font-semibold text-ink">Continue watching</h2>
            {lists.progress?.episodes?.length ? (
              <ul className="mt-3 space-y-2">
                {lists.progress.episodes.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="inline-flex min-h-11 items-center text-sm text-honey">
                      {item.series} · Season {item.season} · Episode {item.episode} · Resume
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-3 text-sm leading-relaxed text-muted">{lists.progress?.note || 'Playback position is not stored.'}</p>
            <Link href="/account/recent" className="mt-3 inline-flex min-h-11 items-center text-sm text-honey">Open watch history</Link>
          </section>
          <Shelf title="My List" href="/my-list" movies={lists.watchlist} empty="Your list is empty." />
          <Shelf title="Favorites" href="/account/favorites" movies={lists.favorites} empty="No favorites yet." />
          <Shelf title="Watch history" href="/account/recent" movies={lists.recent} empty="Nothing viewed in this account yet." />
          {lists.suggestions?.movies?.length ? (
            <Shelf title={`Because you like ${lists.suggestions.genre.name}`} href={`/genre/${lists.suggestions.genre.slug}`} movies={lists.suggestions.movies} empty="" />
          ) : null}
          {lists.countries?.movies?.length ? (
            <Shelf title={lists.countries.title} movies={lists.countries.movies} empty="" />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
