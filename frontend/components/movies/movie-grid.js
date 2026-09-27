import { MovieCard } from './movie-card';

export function MovieGrid({ movies }) {
  if (!movies?.length) return null;
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {movies.map((movie) => (
        <li key={movie.slug}>
          <MovieCard movie={movie} />
        </li>
      ))}
    </ul>
  );
}
