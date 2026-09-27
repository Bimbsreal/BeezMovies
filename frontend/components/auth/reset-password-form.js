'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '../../lib/auth/api';
import { AuthButton, AuthError, AuthField, AuthPanel, TextLink } from './auth-panel';

function ResetPasswordFields() {
  const params = useSearchParams();
  const token = params.get('token') || '';
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') || '');
    if (!token) {
      setError('This reset link is missing a token.');
      return;
    }
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Use at least 10 characters, including a letter and a number.');
      return;
    }

    setPending(true);
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: { token, password },
      });
      setDone(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The password was not reset');
      setPending(false);
    }
  }

  return (
    <AuthPanel
      title="Choose a new password"
      footer={<TextLink href="/login">Back to sign in</TextLink>}
    >
      {done ? (
        <p className="text-sm text-muted">Your password is updated. Sign in with the new password.</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <AuthError error={error} />
          <AuthField label="New password" name="password" type="password" autoComplete="new-password" required minLength={10} />
          <AuthButton pending={pending}>Update password</AuthButton>
        </form>
      )}
    </AuthPanel>
  );
}

export function ResetPasswordForm() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading reset form…</p>}>
      <ResetPasswordFields />
    </Suspense>
  );
}
