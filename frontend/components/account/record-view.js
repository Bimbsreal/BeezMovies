'use client';

import { useEffect } from 'react';
import { api } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';

export function RecordView({ slug }) {
  const { status } = useAuth();

  useEffect(() => {
    if (status !== 'authenticated' || !slug) return undefined;
    api(`/me/recent/${encodeURIComponent(slug)}`, { method: 'POST', body: {} }).catch(() => {});
    return undefined;
  }, [status, slug]);

  return null;
}
