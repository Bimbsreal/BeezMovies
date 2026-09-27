'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api/client';
import { Feedback, Notice, formatWhen, runConfirmed, statusLabel, useResource } from './admin-ui';

export function MoviesView() {
  const [query, setQuery] = useState({ q: '', status: '', sort: 'updated_at', direction: 'desc', page: 1 });
  const [draft, setDraft] = useState(query);
  const [selected, setSelected] = useState([]);
  const [genreSlug, setGenreSlug] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const genres = useResource('/admin/genres');
  const countries = useResource('/admin/countries');
  const collections = useResource('/admin/collections');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.status) params.set('status', query.status);
  params.set('sort', query.sort);
  params.set('direction', query.direction);
  params.set('page', String(query.page));
  const state = useResource(`/admin/movies?${params.toString()}`);
  const rows = state.data?.data || [];
  const pagination = state.data?.pagination;

  function toggle(id) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function create(event) {
    event.preventDefault();
    setMessage('');
    setError('');
    const result = await runConfirmed(
      `Create a draft movie named “${title.trim()}”?`,
      () => api('/admin/movies', { method: 'POST', body: { canonicalTitle: title.trim(), confirm: true } }),
    );
    if (result.cancelled) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setTitle('');
    setMessage('Draft created.');
    state.reload();
  }

  async function bulk(action, extra = {}) {
    setMessage('');
    setError('');
    const result = await runConfirmed(
      `${action} ${selected.length} selected movie${selected.length === 1 ? '' : 's'}? This runs in the background.`,
      () => api('/admin/movies/bulk', { method: 'POST', body: { action, ids: selected, confirm: true, ...extra } }),
    );
    if (result.cancelled) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSelected([]);
    setMessage('Bulk action queued.');
    state.reload();
  }

  return (
    <>
      <h1>Movies</h1>
      <form className="admin-filters" onSubmit={create}>
        <label>New draft title<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={300} /></label>
        <button type="submit">Create draft</button>
      </form>
      <form
        className="admin-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery({ ...draft, page: 1 });
        }}
      >
        <label>Search<input value={draft.q} onChange={(event) => setDraft({ ...draft, q: event.target.value })} /></label>
        <label>Status
          <select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}>
            <option value="">All</option>
            <option value="draft">Draft</option>
            <option value="review">Review</option>
            <option value="approved">Approved</option>
            <option value="active">Published</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label>Sort
          <select value={draft.sort} onChange={(event) => setDraft({ ...draft, sort: event.target.value })}>
            <option value="updated_at">Updated</option>
            <option value="created_at">Created</option>
            <option value="title">Title</option>
            <option value="release_year">Year</option>
            <option value="status">Status</option>
          </select>
        </label>
        <label>Direction
          <select value={draft.direction} onChange={(event) => setDraft({ ...draft, direction: event.target.value })}>
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </label>
        <button type="submit">Apply</button>
      </form>
      <Feedback message={message} error={error} />
      <Notice state={state} empty={state.status === 'ready' && rows.length === 0} />
      {rows.length ? (
        <>
          <div className="admin-actions">
            <button type="button" disabled={!selected.length} onClick={() => bulk('publish')}>Publish selected</button>
            <button type="button" disabled={!selected.length} onClick={() => bulk('unpublish')}>Unpublish selected</button>
            <button type="button" disabled={!selected.length} onClick={() => bulk('archive')}>Archive selected</button>
            <button type="button" disabled={!selected.length} onClick={() => bulk('reindex')}>Reindex selected</button>
            <label>Genre
              <select value={genreSlug} onChange={(event) => setGenreSlug(event.target.value)}>
                <option value="">Choose</option>
                {(genres.data?.data || []).filter((genre) => !genre.archived).map((genre) => (
                  <option key={genre.id} value={genre.slug}>{genre.name}</option>
                ))}
              </select>
            </label>
            <button type="button" disabled={!selected.length || !genreSlug} onClick={() => bulk('assignGenre', { genreSlug })}>Assign genre</button>
            <label>Country
              <select value={countryCode} onChange={(event) => setCountryCode(event.target.value)}>
                <option value="">Choose</option>
                {(countries.data?.data || []).filter((country) => country.active).map((country) => (
                  <option key={country.id} value={country.code}>{country.displayName}</option>
                ))}
              </select>
            </label>
            <button type="button" disabled={!selected.length || !countryCode} onClick={() => bulk('assignCountry', { countryCode })}>Assign country</button>
            <label>Collection
              <select value={collectionId} onChange={(event) => setCollectionId(event.target.value)}>
                <option value="">Choose</option>
                {(collections.data?.data || []).map((collection) => (
                  <option key={collection.id} value={collection.id}>{collection.name}</option>
                ))}
              </select>
            </label>
            <button type="button" disabled={!selected.length || !collectionId} onClick={() => bulk('assignCollection', { collectionId })}>Assign collection</button>
          </div>
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Select</th>
                <th scope="col">Title</th>
                <th scope="col">Year</th>
                <th scope="col">Status</th>
                <th scope="col">Genres</th>
                <th scope="col">Created</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((movie) => (
                <tr key={movie.id}>
                  <td><input type="checkbox" checked={selected.includes(movie.id)} onChange={() => toggle(movie.id)} aria-label={`Select ${movie.title}`} /></td>
                  <td><Link href={`/admin/movies/${movie.id}`}>{movie.title}</Link></td>
                  <td>{movie.releaseYear || '—'}</td>
                  <td>{statusLabel(movie.status)}</td>
                  <td>{movie.genres.join(', ') || '—'}</td>
                  <td>{formatWhen(movie.createdAt)}</td>
                  <td>{formatWhen(movie.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pagination ? (
            <div className="admin-actions">
              <button type="button" disabled={query.page <= 1} onClick={() => setQuery({ ...query, page: query.page - 1 })}>Previous</button>
              <span>Page {pagination.page} of {Math.max(1, Math.ceil(pagination.total / pagination.limit))}</span>
              <button type="button" disabled={query.page * pagination.limit >= pagination.total} onClick={() => setQuery({ ...query, page: query.page + 1 })}>Next</button>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}
