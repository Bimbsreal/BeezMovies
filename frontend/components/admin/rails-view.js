'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api/client';
import { Feedback, Notice, useResource } from './admin-ui';

export function RailsView() {
  const state = useResource('/admin/rails');
  const published = useResource('/discovery/home');
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (state.data?.data) setRows(state.data.data);
  }, [state.data]);

  function update(id, patch) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  async function save(row) {
    setMessage('');
    setError('');
    try {
      await api(`/admin/rails/${row.id}`, {
        method: 'PATCH',
        body: {
          title: row.title,
          enabled: row.enabled,
          sortOrder: Number(row.sortOrder),
          itemLimit: Number(row.itemLimit),
          confirm: true,
        },
      });
      setMessage(`${row.title} saved.`);
    } catch (cause) {
      setError(cause.message || 'The rail could not be saved.');
    }
  }

  return (
    <>
      <h1>Homepage rails</h1>
      <Notice state={state} />
      <Feedback message={message} error={error} />
      <section>
        <h2>Unsaved order</h2>
        <ol>
          {rows.filter((row) => row.enabled).sort((left, right) => left.sortOrder - right.sortOrder).map((row) => (
            <li key={row.id}>{row.title} · {row.source} · up to {row.itemLimit}</li>
          ))}
        </ol>
        <h2>Published homepage</h2>
        {published.data?.data?.rails?.length ? (
          <ul>
            {published.data.data.rails.map((rail) => (
              <li key={`${rail.source}-${rail.title}`}>{rail.title} · {rail.items?.length || 0} items</li>
            ))}
          </ul>
        ) : <p className="admin-note">Published rails appear here after the public homepage loads.</p>}
      </section>
      <div className="admin-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Source</th>
              <th>Order</th>
              <th>Limit</th>
              <th>Enabled</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td><input value={row.title} onChange={(event) => update(row.id, { title: event.target.value })} /></td>
                <td>{row.source}{row.sourceSlug ? ` · ${row.sourceSlug}` : ''}</td>
                <td><input type="number" value={row.sortOrder} onChange={(event) => update(row.id, { sortOrder: Number(event.target.value) })} /></td>
                <td><input type="number" value={row.itemLimit} onChange={(event) => update(row.id, { itemLimit: Number(event.target.value) })} /></td>
                <td><input type="checkbox" checked={row.enabled} onChange={(event) => update(row.id, { enabled: event.target.checked })} /></td>
                <td><button type="button" onClick={() => save(row)}>Save</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
