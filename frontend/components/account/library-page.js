'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';
import { AccountNav } from './account-nav';
import { MovieCard } from '../movies/movie-card';

export function LibraryPage({ title, path, empty, removePath, clearPath }) {
  const { status } = useAuth();
  const [movies, setMovies] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (status !== 'authenticated') return undefined;
    let active = true;
    api(`${path}${path.includes('?') ? '&' : '?'}page=${page}&limit=24`)
      .then((body) => {
        if (!active) return;
        setMovies(body.data || []);
        setPagination(body.pagination || null);
        setReady(true);
      })
      .catch((cause) => {
        if (!active) return;
        setError(cause instanceof ApiError ? cause.message : 'This list could not be loaded.');
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, [status, path, page]);

  if (status === 'loading' || (status === 'authenticated' && !ready && !error)) {
    return <p className="page-wrap py-16 text-sm text-muted">Checking your session…</p>;
  }

  if (status !== 'authenticated') {
    return (
      <section className="page-wrap py-16">
        <h1 className="text-3xl font-semibold text-ink">{title}</h1>
        <p className="mt-3 max-w-xl text-muted">Sign in to use this list. Browsing and downloads stay open without an account.</p>
        <Link href="/login" className="mt-6 inline-block min-h-11 text-honey">Sign in</Link>
      </section>
    );
  }

  return (
    <div className="page-wrap py-8 md:py-10">
      <AccountNav />
      <h1 className="text-3xl font-semibold tracking-tight text-ink">{title}</h1>
      {error ? <p className="mt-4 text-sm text-honey" role="alert">{error}</p> : null}
      {clearPath && movies.length > 0 ? (
        <button
          type="button"
          className="mt-4 min-h-11 border border-white/15 px-4 text-sm text-ink"
          onClick={async () => {
            setError('');
            try {
              await api(clearPath, { method: 'DELETE' });
              setMovies([]);
              setPagination(null);
            } catch (cause) {
              setError(cause instanceof ApiError ? cause.message : 'History could not be cleared.');
            }
          }}
        >
          Clear history
        </button>
      ) : null}
      {ready && movies.length === 0 ? <p className="mt-6 text-muted">{empty}</p> : null}
      <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {movies.map((movie) => (
          <li key={movie.slug}>
            <MovieCard movie={movie} />
            {removePath ? (
              <button
                type="button"
                className="mt-2 min-h-11 px-1 text-sm text-muted"
                onClick={async () => {
                  setError('');
                  try {
                    await api(`${removePath}/${encodeURIComponent(movie.slug)}`, { method: 'DELETE' });
                    setMovies((current) => current.filter((item) => item.slug !== movie.slug));
                  } catch (cause) {
                    setError(cause instanceof ApiError ? cause.message : 'This movie could not be removed.');
                  }
                }}
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {pagination && pagination.totalPages > 1 ? (
        <nav className="mt-8 flex items-center gap-4 text-sm" aria-label="List pages">
          {page > 1 ? <button type="button" className="min-h-11 text-honey" onClick={() => setPage(page - 1)}>Previous</button> : null}
          <span className="text-muted">Page {page} of {pagination.totalPages}</span>
          {page < pagination.totalPages ? <button type="button" className="min-h-11 text-honey" onClick={() => setPage(page + 1)}>Next</button> : null}
        </nav>
      ) : null}
    </div>
  );
}
