'use client';

import { useState } from 'react';
import { api, ApiError } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';

export function LibraryActions({ slug }) {
  const { status } = useAuth();
  const [message, setMessage] = useState('');

  if (status !== 'authenticated') return null;

  async function save(kind, label) {
    setMessage('');
    try {
      await api(`/me/${kind}/${encodeURIComponent(slug)}`, { method: 'POST', body: {} });
      setMessage(label);
    } catch (cause) {
      setMessage(cause instanceof ApiError ? cause.message : 'Could not save this movie.');
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="min-h-11 border border-white/20 px-4 text-sm text-ink" onClick={() => save('watchlist', 'Added to My List.')}>
          Add to My List
        </button>
        <button type="button" className="min-h-11 border border-white/20 px-4 text-sm text-ink" onClick={() => save('favorites', 'Saved to favorites.')}>
          Favorite
        </button>
      </div>
      {message ? <p className="mt-2 text-xs text-muted" aria-live="polite">{message}</p> : null}
    </div>
  );
}
