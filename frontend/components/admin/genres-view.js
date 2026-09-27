'use client';

import { useState } from 'react';
import { api } from '../../lib/api/client';
import { Feedback, Notice, runConfirmed, useResource } from './admin-ui';

export function GenresView() {
  const state = useResource('/admin/genres');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const rows = state.data?.data || [];

  async function create(event) {
    event.preventDefault();
    setMessage('');
    setError('');
    try {
      await api('/admin/genres', { method: 'POST', body: { name } });
      setName('');
      setMessage('Genre created.');
      state.reload();
    } catch (cause) {
      setError(cause.message || 'Create failed');
    }
  }

  async function rename(row) {
    const next = window.prompt('Genre name', row.name);
    if (!next || next.trim() === row.name) return;
    setMessage('');
    setError('');
    try {
      await api(`/admin/genres/${row.id}`, { method: 'PATCH', body: { name: next.trim() } });
      setMessage('Genre updated.');
      state.reload();
    } catch (cause) {
      setError(cause.message || 'Update failed');
    }
  }

  async function merge(row, targetId) {
    setMessage('');
    setError('');
    const target = rows.find((item) => item.id === targetId);
    if (!target) return;
    const result = await runConfirmed(
      `Move movies from ${row.name} into ${target.name} and archive ${row.name}? The genre row stays in place.`,
      () => api(`/admin/genres/${row.id}/merge`, { method: 'POST', body: { targetId, confirm: true } }),
    );
    if (result.cancelled) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage('Genre merged and archived.');
    state.reload();
  }

  async function archive(row) {
    setMessage('');
    setError('');
    const result = await runConfirmed(`Archive genre ${row.name}?`, () => api(`/admin/genres/${row.id}/archive`, {
      method: 'POST',
      body: { confirm: true },
    }));
    if (result.cancelled) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage('Genre archived.');
    state.reload();
  }

  return (
    <>
      <h1>Genres</h1>
      <form className="admin-filters" onSubmit={create}>
        <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} /></label>
        <button type="submit">Create</button>
      </form>
      <Feedback message={message} error={error} />
      <Notice state={state} empty={state.status === 'ready' && rows.length === 0} />
      {rows.length ? (
        <table className="admin-table">
          <thead>
            <tr><th>Name</th><th>Slug</th><th>Movies</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.slug}</td>
                <td>{row.movieCount}</td>
                <td>{row.archived ? 'Archived' : 'Active'}</td>
                <td>
                  <button type="button" onClick={() => rename(row)}>Rename</button>
                  <button type="button" onClick={() => archive(row)} disabled={row.archived}>Archive</button>
                  <select
                    aria-label={`Merge ${row.name} into`}
                    defaultValue=""
                    onChange={(event) => {
                      const targetId = event.target.value;
                      event.target.value = '';
                      if (targetId) merge(row, targetId);
                    }}
                    disabled={row.archived}
                  >
                    <option value="">Merge into…</option>
                    {rows.filter((item) => item.id !== row.id && !item.archived).map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
