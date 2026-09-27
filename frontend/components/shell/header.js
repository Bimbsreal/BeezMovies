'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AccountLink } from '../auth/account-link';
import { SearchLauncher } from './search-launcher';
import { STARTUP_ASSET } from '../../lib/startup/phases';

const PRIMARY = [
  { label: 'Home', href: '/' },
  { label: 'Movies', href: '/movies' },
];

const BROWSE = [
  { label: 'Genres', href: '/genres' },
  { label: 'Countries', href: '/countries' },
  { label: 'Collections', href: '/collections' },
  { label: 'New releases', href: '/movies?sort=release_date&order=desc' },
];

function itemCurrent(pathname, href) {
  if (href === '/countries') {
    return pathname === '/countries' || /^\/movies\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pathname);
  }
  return pathname === href;
}

function NavLink({ href, label, pathname, onNavigate }) {
  const current = itemCurrent(pathname, href);
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      onClick={onNavigate}
      className={`inline-flex min-h-11 items-center px-3 text-sm ${current ? 'text-ink' : 'text-muted'} hover:text-ink`}
    >
      {label}
    </Link>
  );
}

function BrowseLinks({ pathname, onNavigate }) {
  return BROWSE.map((item) => (
    <NavLink key={item.href} {...item} pathname={pathname} onNavigate={onNavigate} />
  ));
}

export function Header() {
  const pathname = usePathname() || '/';
  const browsing = BROWSE.some((item) => itemCurrent(pathname, item.href));

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-obsidian/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-2 px-3 md:h-16 md:px-8">
        <Link href="/" className="flex min-w-0 items-center gap-2">
          {/* Official asset is served as-is. next/image would re-encode it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={STARTUP_ASSET} alt="" className="h-9 w-auto shrink-0" />
          <span className="truncate text-base font-semibold tracking-tight text-ink">
            Beez<span className="text-honey">Movies</span>
          </span>
        </Link>
        <nav aria-label="Primary" className="ml-4 hidden items-center md:flex">
          {PRIMARY.map((item) => (
            <NavLink key={item.href} {...item} pathname={pathname} />
          ))}
          <details className="relative">
            <summary className={`flex min-h-11 cursor-pointer list-none items-center px-3 text-sm ${browsing ? 'text-ink' : 'text-muted'}`}>
              Browse
            </summary>
            <div className="absolute left-0 z-50 mt-1 flex min-w-44 flex-col border border-white/10 bg-surface py-1">
              <BrowseLinks pathname={pathname} />
            </div>
          </details>
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <div className="hidden min-w-0 md:block md:w-56 lg:w-72">
            <SearchLauncher presentation="field" />
          </div>
          <div className="md:hidden">
            <SearchLauncher />
          </div>
          <div className="hidden md:block">
            <AccountLink />
          </div>
          <details className="relative md:hidden">
            <summary className="flex h-11 cursor-pointer list-none items-center px-3 text-sm text-ink">
              Menu
            </summary>
            <nav aria-label="Mobile" className="absolute right-0 z-50 mt-1 w-56 border border-white/10 bg-surface py-2">
              <div className="flex flex-col">
                {PRIMARY.map((item) => (
                  <NavLink key={item.href} {...item} pathname={pathname} />
                ))}
                <p className="px-3 pt-3 text-xs uppercase tracking-[0.16em] text-muted">Browse</p>
                <BrowseLinks pathname={pathname} />
                <AccountLink />
              </div>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
