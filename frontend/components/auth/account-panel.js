'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '../../lib/auth/api';
import { AccountNav } from '../account/account-nav';
import { useAuth } from './auth-provider';
import { AuthButton, AuthError, AuthPanel, TextLink } from './auth-panel';

export function AccountPanel() {
  const router = useRouter();
  const { status, user, setUser } = useAuth();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function logout() {
    setError('');
    setPending(true);
    try {
      await api('/auth/logout', { method: 'POST' });
      setUser(null);
      router.push('/login');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Sign out failed');
      setPending(false);
    }
  }

  if (status === 'loading') {
    return <AuthPanel title="Account"><p className="text-sm text-muted">Checking your session…</p></AuthPanel>;
  }

  if (status !== 'authenticated' || !user) {
    return (
      <AuthPanel title="Account" footer={<TextLink href="/register">Create an account</TextLink>}>
        <p className="text-sm text-muted">Sign in to see this account.</p>
        <div className="mt-4">
          <TextLink href="/login">Sign in</TextLink>
        </div>
      </AuthPanel>
    );
  }

  const rows = [
    ['Display name', user.displayName],
    ['Email', user.email],
    ['Role', user.role],
    ['Status', user.accountStatus],
    ['Email verified', user.emailVerified ? 'Yes' : 'Not yet'],
  ];

  return (
    <div className="page-wrap max-w-3xl py-8">
      <AccountNav />
      <AuthPanel title="Profile">
      <dl className="space-y-3 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 border-b border-white/10 pb-3">
            <dt className="text-muted">{label}</dt>
            <dd className="text-right text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <form
        className="mt-5 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          logout();
        }}
      >
        <AuthError error={error} />
        <AuthButton pending={pending}>Sign out</AuthButton>
      </form>
    </AuthPanel>
    </div>
  );
}
