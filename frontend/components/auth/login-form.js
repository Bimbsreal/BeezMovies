'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '../../lib/auth/api';
import { useAuth } from './auth-provider';
import { AuthButton, AuthError, AuthField, AuthPanel, TextLink } from './auth-panel';

export function LoginForm() {
  const router = useRouter();
  const { setUser, status, user } = useAuth();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [nextPath, setNextPath] = useState('/account');

  useEffect(() => {
    const next = new URLSearchParams(window.location.search).get('next') || '';
    if (/^\/admin(\/|$)/.test(next)) setNextPath(next);
  }, []);

  async function onSubmit(event) {
    event.preventDefault();
    setError('');
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const payload = await api('/auth/login', {
        method: 'POST',
        body: {
          email: form.get('email'),
          password: form.get('password'),
        },
      });
      setUser(payload.user);
      router.push(nextPath);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Sign in failed');
      setPending(false);
    }
  }

  return (
    <AuthPanel
      title="Sign in"
      footer={(
        <>
          New to BeezMovies? <TextLink href="/register">Create an account</TextLink>
        </>
      )}
    >
      {status === 'authenticated' ? (
        <p className="text-sm text-muted">
          Signed in as {user.displayName}. <Link href={nextPath} className="text-honey">{nextPath.startsWith('/admin') ? 'Open admin' : 'Go to your account'}</Link>
        </p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <AuthError error={error} />
          <AuthField label="Email" name="email" type="email" autoComplete="email" required />
          <AuthField label="Password" name="password" type="password" autoComplete="current-password" required />
          <AuthButton pending={pending}>Sign in</AuthButton>
          <TextLink href="/forgot-password">Forgot password</TextLink>
        </form>
      )}
    </AuthPanel>
  );
}
