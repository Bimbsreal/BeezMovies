'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '../auth/auth-provider';

const LINKS = [
  ['/admin/dashboard', 'Dashboard'],
  ['/admin/analytics', 'Analytics'],
  ['/admin/movies', 'Movies'],
  ['/admin/catalog-health', 'Catalog health'],
  ['/admin/reviews', 'Reviews'],
  ['/admin/genres', 'Genres'],
  ['/admin/catalog/countries', 'Countries'],
  ['/admin/catalog/content-types', 'Content types'],
  ['/admin/catalog/series', 'Series'],
  ['/admin/catalog/localization', 'Localization'],
  ['/admin/collections', 'Collections'],
  ['/admin/homepage', 'Homepage'],
  ['/admin/people', 'People'],
  ['/admin/media', 'Media'],
  ['/admin/providers', 'Providers'],
  ['/admin/ingestion', 'Ingestion'],
  ['/admin/ingestion/sync', 'Sync'],
  ['/admin/ingestion/bootstrap', 'Bootstrap'],
  ['/admin/search', 'Search'],
  ['/admin/users', 'Users'],
  ['/admin/system', 'System'],
  ['/admin/operations', 'Operations'],
  ['/admin/settings', 'Settings'],
  ['/admin/monetization', 'Monetization'],
  ['/admin/audit', 'Audit'],
  ['/admin/complaints', 'Complaints'],
];

export function AdminShell({ children }) {
  const pathname = usePathname() || '';
  const { status, user } = useAuth();
  const roles = user?.roles || [];
  const catalog = roles.includes('admin') || roles.includes('super_admin') || roles.includes('content_admin');
  const allowed = catalog || roles.includes('moderator');

  return (
    <div className="admin-frame">
      <nav className="admin-nav" aria-label="Admin">
        <p className="admin-brand">BeezMovies</p>
        {LINKS.filter(([href]) => catalog || href === '/admin/dashboard' || href === '/admin/audit' || href === '/admin/reviews').map(([href, label]) => {
          const current = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link key={href} href={href} aria-current={current ? 'page' : undefined}>
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="admin-main" id="content">
        {status === 'loading' ? <p className="admin-note">Loading session…</p> : null}
        {status === 'unauthenticated' ? (
          <p className="admin-note" role="alert">
            Sign in with an administrator account. <Link href="/login?next=/admin/dashboard">Sign in</Link>
          </p>
        ) : null}
        {status === 'authenticated' && !allowed ? (
          <p className="admin-note" role="alert">Permission denied. This account cannot open the control plane.</p>
        ) : null}
        {status === 'authenticated' && allowed && !catalog ? (
          <p className="admin-note">Catalog changes require a content administrator. Review and audit remain available.</p>
        ) : null}
        {status === 'authenticated' && allowed ? children : null}
      </div>
    </div>
  );
}
