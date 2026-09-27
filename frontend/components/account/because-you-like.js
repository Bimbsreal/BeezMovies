'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';
import { MovieCard } from '../movies/movie-card';
import { Rail } from '../movies/rail';

export function BecauseYouLike() {
  const { status } = useAuth();
  const [rail, setRail] = useState(null);

  useEffect(() => {
    if (status !== 'authenticated') return undefined;
    let active = true;
    api('/me/suggestions')
      .then((body) => {
        if (active) setRail(body.data || null);
      })
      .catch(() => {
        if (active) setRail(null);
      });
    return () => {
      active = false;
    };
  }, [status]);

  if (!rail?.movies?.length) return null;

  return (
    <Rail title={`Because you like ${rail.genre.name}`} href={`/genre/${rail.genre.slug}`} analytics="rec:because-you-like">
      {rail.movies.map((movie) => <MovieCard key={movie.slug} movie={movie} />)}
    </Rail>
  );
}
