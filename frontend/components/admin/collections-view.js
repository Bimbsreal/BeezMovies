'use client';

import { useState } from 'react';
import { api } from '../../lib/api/client';
import { Feedback, Notice, runConfirmed, useResource } from './admin-ui';

export function CollectionsView() {
  const state = useResource('/admin/collections');
  const [name, setName] = useState('');
  const [orders, setOrders] = useState({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const rows = state.data?.data || [];

  function moviesFor(row) {
    return orders[row.id] || row.movies || [];
  }

  function move(row, index, direction) {
    const movies = [...moviesFor(row)];
    const target = index + direction;
    if (target < 0 || target >= movies.length) return;
    const [item] = movies.splice(index, 1);
    movies.splice(target, 0, item);
    setOrders({ ...orders, [row.id]: movies });
  }

  async function create(event) {
    event.preventDefault();
    setMessage('');
    setError('');
    try {
      await api('/admin/collections', { method: 'POST', body: { name } });
      setName('');
      setMessage('Collection created.');
      state.reload();
    } catch (cause) {
      setError(cause.message || 'Create failed');
    }
  }

  async function publish(row, published) {
    setMessage('');
    setError('');
    const action = published ? 'publish' : 'archive';
    const result = await runConfirmed(
      published ? `Publish ${row.name}?` : `Archive ${row.name}?`,
      () => api(`/admin/collections/${row.id}/${action}`, { method: 'POST', body: { confirm: true } }),
    );
    if (result.cancelled) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(published ? 'Collection published.' : 'Collection archived.');
    state.reload();
  }

  async function reindex(row) {
    setMessage('');
    setError('');
    const result = await runConfirmed(
      `Reindex movies in ${row.name}?`,
      () => api(`/admin/collections/${row.id}/reindex`, { method: 'POST', body: { confirm: true } }),
    );
    if (result.cancelled) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(`Search update queued for ${result.payload?.data?.queued ?? 0} movies.`);
  }

  async function saveOrder(row) {
    setMessage('');
    setError('');
    const movieIds = moviesFor(row).map((movie) => movie.id);
    try {
      await api(`/admin/collections/${row.id}/order`, { method: 'POST', body: { movieIds } });
      setMessage('Order saved.');
      state.reload();
    } catch (cause) {
      setError(cause.message || 'Order failed');
    }
  }

  return (
    <>
      <h1>Collections</h1>
      <form className="admin-filters" onSubmit={create}>
        <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} /></label>
        <button type="submit">Create</button>
      </form>
      <Feedback message={message} error={error} />
      <Notice state={state} empty={state.status === 'ready' && rows.length === 0} />
      {rows.map((row) => (
        <section key={row.id} className="admin-block">
          <h2>{row.name}</h2>
          <p className="admin-meta">{row.slug} · {row.published ? 'Published' : 'Archived'} · {row.movieCount} movies</p>
          <div className="admin-actions">
            <button type="button" onClick={() => publish(row, true)} disabled={row.published}>Publish</button>
            <button type="button" onClick={() => publish(row, false)} disabled={!row.published}>Archive</button>
            <button type="button" onClick={() => reindex(row)}>Reindex</button>
          </div>
          <ol>
            {moviesFor(row).map((movie, index) => (
              <li key={movie.id}>
                {movie.title}
                <button type="button" onClick={() => move(row, index, -1)} disabled={index === 0}>Up</button>
                <button type="button" onClick={() => move(row, index, 1)} disabled={index === moviesFor(row).length - 1}>Down</button>
              </li>
            ))}
          </ol>
          {row.movieCount ? <button type="button" onClick={() => saveOrder(row)}>Save order</button> : <p className="admin-note">No movies in this collection.</p>}
        </section>
      ))}
    </>
  );
}
