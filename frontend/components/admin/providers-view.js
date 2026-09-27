'use client';

import { useState } from 'react';
import { api } from '../../lib/api/client';
import { Feedback, Notice, formatWhen, runConfirmed, useResource } from './admin-ui';

export function ProvidersView() {
  const state = useResource('/admin/providers');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const rows = state.data?.data || [];

  async function act(row, action, label) {
    setMessage('');
    setError('');
    const result = await runConfirmed(`${label} ${row.name}?`, () => api(`/admin/providers/${row.id}/${action}`, {
      method: 'POST',
      body: { confirm: true },
    }));
    if (result.cancelled) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(`${label} completed.`);
    state.reload();
  }

  return (
    <>
      <h1>Providers</h1>
      <Feedback message={message} error={error} />
      <Notice state={state} empty={state.status === 'ready' && rows.length === 0} />
      {rows.length ? (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th><th>Status</th><th>Health</th><th>Last success</th><th>Last failure</th><th>Media types</th><th>Credentials</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.status}</td>
                <td>{row.health}</td>
                <td>{formatWhen(row.lastSuccessAt)}</td>
                <td>{row.lastFailure || '—'}</td>
                <td>{(row.mediaTypes || []).join(', ') || '—'}</td>
                <td>{row.credentials}</td>
                <td>
                  <button type="button" onClick={() => act(row, 'health-check', 'Check')}>Health check</button>
                  <button type="button" onClick={() => act(row, 'enable', 'Enable')} disabled={row.status === 'active'}>Enable</button>
                  <button type="button" onClick={() => act(row, 'disable', 'Disable')} disabled={row.status !== 'active'}>Disable</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
