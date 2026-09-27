'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  ['/account', 'Profile'],
  ['/my-list', 'My List'],
  ['/account/favorites', 'Favorites'],
  ['/account/recent', 'Watch history'],
  ['/account/settings', 'Settings'],
];

export function AccountNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Account" className="mb-6 flex gap-2 overflow-x-auto">
      {LINKS.map(([href, label]) => {
        const current = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? 'page' : undefined}
            className={`min-h-11 shrink-0 px-3 py-2 text-sm ${current ? 'bg-elevated text-ink' : 'text-muted'}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
