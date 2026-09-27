import Link from 'next/link';
import { Artwork } from './artwork';
import { PreviewButton } from './preview-button';
import { backdropUrl, previewUrl, releaseYear, runtimeLabel } from '../../lib/catalog/present';

export function Hero({ movie }) {
  const year = releaseYear(movie);
  const runtime = runtimeLabel(movie.runtimeMinutes);
  const genres = (movie.genres || []).map((genre) => genre.name).join(' · ');
  const meta = [year, runtime, genres].filter(Boolean).join('  ·  ');

  return (
    <section className="relative min-h-[70vh] overflow-hidden bg-obsidian" data-analytics="rail:hero">
      <div className="absolute inset-0">
        <Artwork src={backdropUrl(movie)} alt="" priority className="object-cover" />
      </div>
      <div className="absolute inset-0 bg-gradient-to-r from-obsidian via-obsidian/80 to-obsidian/20" />
      <div className="absolute inset-0 bg-gradient-to-t from-obsidian via-transparent to-obsidian/40" />
      <div className="page-wrap relative flex min-h-[70vh] items-end pb-12 pt-20 md:pb-16">
        <div className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-honey">Featured</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink sm:text-5xl md:text-6xl">{movie.title}</h1>
          {meta ? <p className="mt-4 text-sm text-ink/90">{meta}</p> : null}
          {movie.synopsis ? (
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink/90 line-clamp-3 md:text-base">{movie.synopsis}</p>
          ) : null}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <PreviewButton src={previewUrl(movie)} title={movie.title} poster={backdropUrl(movie)} analyticsSlug={movie.slug} prominent />
            <Link
              href={`/movie/${movie.slug}`}
              className="inline-flex min-h-11 items-center border border-white/20 px-5 text-sm font-semibold uppercase tracking-[0.14em] text-ink"
            >
              View details
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
