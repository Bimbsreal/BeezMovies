import Link from 'next/link';
import { FooterNative } from '../monetization/sponsored-content';
import { LanguageSelector } from './language-selector';

export function Footer() {
  return (
    <footer className="mt-8 border-t border-white/10">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-2 px-4 py-6 text-sm text-muted sm:flex-row sm:items-center sm:justify-between md:px-8">
        <p>BeezMovies</p>
        <LanguageSelector />
        <p className="flex gap-4">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/copyright">Copyright</Link>
        </p>
      </div>
      <FooterNative />
    </footer>
  );
}
