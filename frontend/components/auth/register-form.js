'use client';

import { useState } from 'react';
import { api, ApiError } from '../../lib/auth/api';
import {
  AuthButton,
  AuthError,
  AuthField,
  AuthPanel,
  DevelopmentNotice,
  TextLink,
} from './auth-panel';

export function RegisterForm() {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [verificationToken, setVerificationToken] = useState('');
  const [created, setCreated] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') || '');
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Use at least 10 characters, including a letter and a number.');
      return;
    }

    setPending(true);
    try {
      const payload = await api('/auth/register', {
        method: 'POST',
        body: {
          email: form.get('email'),
          password,
          displayName: form.get('displayName'),
        },
      });
      setVerificationToken(payload.developmentOnly?.emailVerificationToken || '');
      setCreated(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Registration failed');
      setPending(false);
    }
  }

  return (
    <AuthPanel
      title="Create account"
      footer={(
        <>
          Already registered? <TextLink href="/login">Sign in</TextLink>
        </>
      )}
    >
      {created ? (
        <div className="space-y-4 text-sm text-muted">
          <p>Your account is ready. Sign in to continue. Email delivery is not connected yet.</p>
          <DevelopmentNotice label="verification token" value={verificationToken} />
          <TextLink href="/login">Continue to sign in</TextLink>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <AuthError error={error} />
          <AuthField label="Display name" name="displayName" autoComplete="nickname" required maxLength={80} />
          <AuthField label="Email" name="email" type="email" autoComplete="email" required />
          <AuthField label="Password" name="password" type="password" autoComplete="new-password" required minLength={10} />
          <p className="text-xs text-muted">At least 10 characters, with a letter and a number.</p>
          <AuthButton pending={pending}>Create account</AuthButton>
        </form>
      )}
    </AuthPanel>
  );
}
