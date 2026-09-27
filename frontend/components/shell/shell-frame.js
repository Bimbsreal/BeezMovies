'use client';

import { usePathname } from 'next/navigation';
import { Header } from './header';
import { Footer } from './footer';

export function ShellFrame({ children }) {
  const pathname = usePathname() || '';
  const admin = pathname === '/admin' || pathname.startsWith('/admin/');
  if (admin) {
    return <div className="admin-root">{children}</div>;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-30 focus:rounded-md focus:bg-elevated focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <Header />
      <main id="content" className="w-full flex-1">
        {children}
      </main>
      <Footer />
    </div>
  );
}
