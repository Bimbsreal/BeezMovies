'use client';

import { useState } from 'react';
import { api } from '../../lib/api/client';
import { Feedback, Notice, formatWhen, runConfirmed, useResource } from './admin-ui';

export function MediaView() {
  const state = useResource('/admin/media');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const rows = state.data?.data || [];

  async function act(row, action, label) {
    setMessage('');
    setError('');
    const result = await runConfirmed(`${label} ${row.movie} on ${row.provider}?`, () => api(`/admin/media/${row.id}/${action}`, {
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
      <h1>Media</h1>
      <Feedback message={message} error={error} />
      <Notice state={state} empty={state.status === 'ready' && rows.length === 0} />
      {rows.length ? (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Movie</th><th>Provider</th><th>Type</th><th>Quality</th><th>Availability</th><th>Status</th><th>Last checked</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.movie}</td>
                <td>{row.provider}</td>
                <td>{row.mediaType}</td>
                <td>{row.quality || '—'}</td>
                <td>{row.availability || '—'}</td>
                <td>{row.status}</td>
                <td>{formatWhen(row.lastCheckedAt)}</td>
                <td>
                  <button type="button" onClick={() => act(row, 'validate', 'Validate')}>Validate</button>
                  <button type="button" onClick={() => act(row, 'enable', 'Enable')}>Enable</button>
                  <button type="button" onClick={() => act(row, 'disable', 'Disable')}>Disable</button>
                  <button type="button" onClick={() => act(row, 'archive', 'Remove')}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
