import Link from 'next/link';
import { Artwork } from './artwork';
import { releaseYear } from '../../lib/catalog/present';

export function MovieCard({ movie }) {
  const year = releaseYear(movie);
  const kind = movie.contentType?.name || 'Movie';
  const label = year ? `${movie.title}, ${year}, ${kind}` : `${movie.title}, ${kind}`;
  const href = movie.contentType?.code === 'series' ? `/show/${movie.slug}` : `/movie/${movie.slug}`;

  return (
    <article className="movie-card">
      <Link href={href} className="group block" aria-label={label}>
        <div className="relative aspect-[2/3] overflow-hidden bg-surface">
          <Artwork src={movie.poster?.url} alt="" />
          {movie.synopsis ? (
            <div className="movie-card-detail" aria-hidden="true">
              <p className="line-clamp-4 text-xs leading-relaxed text-ink">{movie.synopsis}</p>
            </div>
          ) : null}
        </div>
        <h3 className="mt-2 line-clamp-2 text-sm font-medium text-ink">{movie.title}</h3>
        {year || movie.contentType?.name ? (
          <p className="text-xs text-muted">{[year, movie.contentType?.name].filter(Boolean).join(' · ')}</p>
        ) : null}
      </Link>
    </article>
  );
}
