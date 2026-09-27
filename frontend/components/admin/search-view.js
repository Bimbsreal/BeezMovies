'use client';

import { useState } from 'react';
import { api } from '../../lib/api/client';
import { Feedback, Notice, runConfirmed, useResource } from './admin-ui';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function SearchView() {
  const state = useResource('/admin/search/status');
  const [movieId, setMovieId] = useState('');
  const [batch, setBatch] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const data = state.data?.data;

  async function reindexOne(event) {
    event.preventDefault();
    setMessage('');
    setError('');
    if (!UUID.test(movieId.trim())) {
      setError('Enter a movie id.');
      return;
    }
    const result = await runConfirmed('Reindex this movie?', () => api(`/admin/search/movies/${movieId.trim()}/reindex`, {
      method: 'POST',
      body: {},
    }));
    if (result.cancelled) return;
    if (!result.ok) setError(result.error);
    else setMessage('Movie reindex finished.');
    state.reload();
  }

  async function reindexBatch(event) {
    event.preventDefault();
    setMessage('');
    setError('');
    const ids = batch.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
    if (!ids.length || ids.some((id) => !UUID.test(id))) {
      setError('Enter movie ids separated by spaces or commas.');
      return;
    }
    const result = await runConfirmed(`Queue reindex for ${ids.length} movies?`, () => api('/admin/search/reindex/batch', {
      method: 'POST',
      body: { ids, confirm: true },
    }));
    if (result.cancelled) return;
    if (!result.ok) setError(result.error);
    else setMessage('Batch reindex queued.');
  }

  async function reindexAll() {
    setMessage('');
    setError('');
    const result = await runConfirmed('Start a full catalog reindex? It runs in the background.', () => api('/admin/search/reindex/full', {
      method: 'POST',
      body: { confirm: true },
    }));
    if (result.cancelled) return;
    if (!result.ok) setError(result.error);
    else {
      setMessage('Full reindex queued.');
      state.reload();
    }
  }

  return (
    <>
      <h1>Search</h1>
      <Notice state={state} />
      {data ? (
        <dl className="admin-detail">
          <div><dt>Index status</dt><dd>{data.indexStatus}</dd></div>
          <div><dt>Indexed movies</dt><dd>{data.indexedMovies}</dd></div>
          <div><dt>Pending updates</dt><dd>{data.pendingUpdates}</dd></div>
          <div><dt>Failed indexing jobs</dt><dd>{data.failedUpdates}</dd></div>
          <div><dt>Latest reindex</dt><dd>{data.reindexStatus || '—'}{data.reindexProcessed === null || data.reindexProcessed === undefined ? '' : ` · ${data.reindexProcessed} processed`}</dd></div>
        </dl>
      ) : null}
      <Feedback message={message} error={error} />
      <form className="admin-filters" onSubmit={reindexOne}>
        <label>Movie id<input value={movieId} onChange={(event) => setMovieId(event.target.value)} /></label>
        <button type="submit">Reindex movie</button>
      </form>
      <form className="admin-form" onSubmit={reindexBatch}>
        <label>Batch movie ids<textarea value={batch} onChange={(event) => setBatch(event.target.value)} rows={3} /></label>
        <button type="submit">Queue batch reindex</button>
      </form>
      <button type="button" onClick={reindexAll}>Full reindex</button>
    </>
  );
}
