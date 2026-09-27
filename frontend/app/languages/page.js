import Link from 'next/link';
import { getLanguages } from '../../lib/api/catalog';
import { StatusPanel } from '../../components/movies/status-panel';

export const metadata = {
  title: 'Languages',
  description: 'Browse BeezMovies by spoken language. Language is separate from country of production.',
  alternates: { canonical: '/languages' },
};

export default async function LanguagesPage() {
  try {
    const body = await getLanguages();
    const languages = body.data || [];
    return (
      <div className="page-wrap py-8 md:py-12">
        <h1 className="text-4xl font-semibold tracking-tight text-ink">Languages</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted">
          These are spoken languages on published movies. A country of production does not decide the language.
        </p>
        <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {languages.map((language) => (
            <li key={language.code}>
              <Link href={`/languages/${language.code}`} className="flex min-h-24 flex-col justify-end bg-surface px-4 py-4" hrefLang={language.code}>
                <span className="text-lg font-medium text-ink">{language.name}</span>
                <span className="mt-1 text-sm text-muted">{language.movieCount} {language.movieCount === 1 ? 'movie' : 'movies'}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  } catch {
    return <StatusPanel title="Languages are unavailable" body="BeezMovies could not load languages." />;
  }
}
