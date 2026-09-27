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

export function ForgotPasswordForm() {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [resetToken, setResetToken] = useState('');

  async function onSubmit(event) {
    event.preventDefault();
    setError('');
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const payload = await api('/auth/forgot-password', {
        method: 'POST',
        body: { email: form.get('email') },
      });
      setResetToken(payload.developmentOnly?.passwordResetToken || '');
      setDone(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The request failed');
      setPending(false);
    }
  }

  return (
    <AuthPanel
      title="Reset password"
      footer={<TextLink href="/login">Back to sign in</TextLink>}
    >
      {done ? (
        <div className="space-y-4 text-sm text-muted">
          <p>If an account exists for that email, a reset link can be issued. No email is sent in this phase.</p>
          <DevelopmentNotice label="reset token" value={resetToken} />
          {resetToken ? (
            <TextLink href={`/reset-password?token=${encodeURIComponent(resetToken)}`}>
              Continue to choose a new password
            </TextLink>
          ) : null}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <AuthError error={error} />
          <AuthField label="Email" name="email" type="email" autoComplete="email" required />
          <AuthButton pending={pending}>Request reset</AuthButton>
        </form>
      )}
    </AuthPanel>
  );
}
