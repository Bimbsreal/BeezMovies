'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './auth-provider';

export function AccountLink() {
  const pathname = usePathname();
  const { status } = useAuth();
  const href = status === 'authenticated' ? '/account' : '/login';
  const label = status === 'authenticated' ? 'Account' : 'Sign in';
  const current = pathname === href;

  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1.5 text-sm text-honey ${current ? 'bg-elevated' : ''}`}
      aria-current={current ? 'page' : undefined}
    >
      {label}
    </Link>
  );
}
