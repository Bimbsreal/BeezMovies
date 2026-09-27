'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api/client';

export function formatWhen(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

export function statusLabel(status) {
  if (status === 'active') return 'Published';
  if (status === 'draft') return 'Draft';
  if (status === 'review') return 'Review';
  if (status === 'approved') return 'Approved';
  if (status === 'archived') return 'Archived';
  return status || '—';
}

export function useResource(path) {
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });
  const reload = useCallback(async () => {
    if (!path) return;
    setState((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const payload = await api(path);
      setState({ status: 'ready', data: payload, error: '' });
    } catch (error) {
      const denied = error instanceof ApiError && (error.status === 401 || error.status === 403);
      setState({
        status: denied ? 'denied' : 'error',
        data: null,
        error: error instanceof ApiError ? error.message : 'Request failed',
      });
    }
  }, [path]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { ...state, reload };
}

export function Notice({ state, empty = false }) {
  if (state.status === 'loading') return <p className="admin-note">Loading…</p>;
  if (state.status === 'denied') return <p className="admin-note" role="alert">Permission denied. {state.error}</p>;
  if (state.status === 'error') return <p className="admin-note" role="alert">{state.error}</p>;
  if (empty) return <p className="admin-note">Nothing to show.</p>;
  return null;
}

export function MetricGrid({ groups }) {
  return (
    <div className="admin-metrics">
      {groups.map((group) => (
        <section key={group.title}>
          <h2>{group.title}</h2>
          <dl>
            {group.items.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

export function Feedback({ message, error }) {
  if (error) return <p className="admin-note" role="alert">{error}</p>;
  if (message) return <p className="admin-note" role="status">{message}</p>;
  return null;
}

export async function runConfirmed(message, work) {
  if (!window.confirm(message)) return { ok: false, cancelled: true };
  try {
    const payload = await work();
    return { ok: true, payload };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof ApiError ? error.message : 'Request failed',
    };
  }
}
