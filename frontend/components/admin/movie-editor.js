'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api/client';
import { Feedback, Notice, formatWhen, runConfirmed, statusLabel, useResource } from './admin-ui';

function sameList(left, right) {
  return JSON.stringify(left || []) === JSON.stringify(right || []);
}

export function MovieEditor({ id }) {
  const movieState = useResource(id ? `/admin/movies/${id}` : null);
  const genres = useResource('/admin/genres');
  const collections = useResource('/admin/collections');
  const movie = movieState.data?.data;
  const [form, setForm] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!movie) return;
    setForm({
      canonicalTitle: movie.title || '',
      originalTitle: movie.originalTitle || '',
      synopsis: movie.synopsis || '',
      tagline: movie.tagline || '',
      releaseDate: movie.releaseDate || '',
      runtimeMinutes: movie.runtimeMinutes ?? '',
      languageCode: movie.languageCode || '',
      genreSlugs: movie.genreSlugs || [],
      countryCodes: (movie.countryCodes || []).join(', '),
      alternateTitles: (movie.alternateTitles || []).join('\n'),
      collectionId: movie.collectionId || '',
    });
  }, [movie]);

  function setField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function save(event) {
    event.preventDefault();
    setMessage('');
    setError('');
    const countries = form.countryCodes.split(',').map((item) => item.trim()).filter(Boolean);
    const titles = form.alternateTitles.split('\n').map((item) => item.trim()).filter(Boolean);
    const runtime = form.runtimeMinutes === '' ? null : Number(form.runtimeMinutes);
    const patch = {};
    if (form.canonicalTitle !== movie.title) patch.canonicalTitle = form.canonicalTitle;
    if ((form.originalTitle || null) !== (movie.originalTitle || null)) patch.originalTitle = form.originalTitle || null;
    if ((form.synopsis || null) !== (movie.synopsis || null)) patch.synopsis = form.synopsis || null;
    if ((form.tagline || null) !== (movie.tagline || null)) patch.tagline = form.tagline || null;
    if ((form.releaseDate || null) !== (movie.releaseDate || null)) patch.releaseDate = form.releaseDate || null;
    if (runtime !== (movie.runtimeMinutes ?? null)) patch.runtimeMinutes = runtime;
    if ((form.languageCode || null) !== (movie.languageCode || null)) patch.languageCode = form.languageCode || null;
    if (!sameList(form.genreSlugs, movie.genreSlugs)) patch.genreSlugs = form.genreSlugs;
    if (!sameList(countries, movie.countryCodes)) patch.countryCodes = countries;
    if (!sameList(titles, movie.alternateTitles)) patch.alternateTitles = titles;
    if ((form.collectionId || null) !== (movie.collectionId || null)) patch.collectionId = form.collectionId || null;
    if (!Object.keys(patch).length) {
      setMessage('No changes to save.');
      return;
    }
    try {
      await api(`/admin/movies/${id}`, { method: 'PATCH', body: patch });
      setMessage('Saved. Changed fields are now curated.');
      movieState.reload();
    } catch (cause) {
      setError(cause.message || 'Save failed');
    }
  }

  function sourceLabel(field) {
    return movie?.provenance?.find((item) => item.field === field)?.source || 'Not recorded';
  }

  async function changeStatus(action) {
    setMessage('');
    setError('');
    const prompts = {
      submit: 'Submit this draft for review?',
      approve: 'Approve this movie? It stays hidden until it is published.',
      publish: 'Publish this approved movie to public discovery?',
      archive: 'Archive this movie? It will leave public discovery.',
      unpublish: 'Unpublish this movie? It stays approved and leaves public discovery.',
      restore: 'Restore this archived movie to draft?',
    };
    const result = await runConfirmed(
      prompts[action],
      () => api(`/admin/movies/${id}/${action}`, { method: 'POST', body: { confirm: true } }),
    );
    if (result.cancelled) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const labels = {
      submit: 'Submitted for review.',
      approve: 'Approved.',
      publish: 'Published.',
      archive: 'Archived.',
      unpublish: 'Unpublished. The movie remains approved.',
      restore: 'Restored to draft.',
    };
    setMessage(labels[action]);
    movieState.reload();
  }

  async function validateMovie() {
    setMessage('');
    setError('');
    try {
      const result = await api(`/admin/movies/${id}/validate`, { method: 'POST', body: {} });
      const issues = result.data?.issues || [];
      setMessage(issues.length ? `Needs attention: ${issues.join(', ')}` : 'Publication checks passed.');
    } catch (cause) {
      setError(cause.message || 'Validation failed');
    }
  }

  async function refreshMovie() {
    setMessage('');
    setError('');
    const result = await runConfirmed(
      'Queue a metadata refresh? Curated fields stay in place.',
      () => api(`/admin/movies/${id}/refresh`, { method: 'POST', body: { confirm: true } }),
    );
    if (result.cancelled) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage('Metadata refresh queued.');
  }

  async function reindexMovie() {
    setMessage('');
    setError('');
    const result = await runConfirmed(
      'Update the search document for this movie?',
      () => api(`/admin/search/movies/${id}/reindex`, { method: 'POST', body: {} }),
    );
    if (result.cancelled) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage('Search update queued.');
  }

  if (!id) return null;

  return (
    <>
      <p><Link href="/admin/movies">Movies</Link></p>
      <h1>{movie?.title || 'Movie'}</h1>
      <Notice state={movieState} />
      {movie && form ? (
        <>
          <p className="admin-meta">Public slug {movie.slug}. Status {statusLabel(movie.status)}. Updated {formatWhen(movie.updatedAt)}.</p>
          {movie.curatedFields?.length ? <p className="admin-meta">Curated fields: {movie.curatedFields.join(', ')}</p> : null}
          <div className="admin-actions">
            <button type="button" onClick={() => changeStatus('submit')} disabled={movie.status !== 'draft'}>Submit for review</button>
            <button type="button" onClick={() => changeStatus('approve')} disabled={movie.status !== 'review'}>Approve</button>
            <button type="button" onClick={() => changeStatus('publish')} disabled={movie.status !== 'approved'}>Publish</button>
            <button type="button" onClick={() => changeStatus('unpublish')} disabled={movie.status !== 'active'}>Unpublish</button>
            <button type="button" onClick={() => changeStatus('archive')} disabled={movie.status === 'archived'}>Archive</button>
            <button type="button" onClick={() => changeStatus('restore')} disabled={movie.status !== 'archived'}>Restore</button>
            <button type="button" onClick={validateMovie}>Validate</button>
            <button type="button" onClick={refreshMovie}>Refresh metadata</button>
            <button type="button" onClick={reindexMovie}>Reindex</button>
            <Link href="/admin/audit">Audit history</Link>
          </div>
          <Feedback message={message} error={error} />
          <form className="admin-form" onSubmit={save}>
            <label>Title<input value={form.canonicalTitle} onChange={(event) => setField('canonicalTitle', event.target.value)} required /></label>
            <p className="admin-note">Source: {sourceLabel('canonical_title')}</p>
            <label>Original title<input value={form.originalTitle} onChange={(event) => setField('originalTitle', event.target.value)} /></label>
            <label>Tagline<input value={form.tagline} onChange={(event) => setField('tagline', event.target.value)} /></label>
            <label>Synopsis<textarea value={form.synopsis} onChange={(event) => setField('synopsis', event.target.value)} rows={5} /></label>
            <p className="admin-note">Source: {sourceLabel('synopsis')}</p>
            <label>Release date<input type="date" value={form.releaseDate || ''} onChange={(event) => setField('releaseDate', event.target.value)} /></label>
            <label>Runtime minutes<input type="number" min="1" max="1000" value={form.runtimeMinutes} onChange={(event) => setField('runtimeMinutes', event.target.value)} /></label>
            <label>Language code<input value={form.languageCode} onChange={(event) => setField('languageCode', event.target.value)} /></label>
            <fieldset>
              <legend>Genres</legend>
              {(genres.data?.data || []).filter((genre) => !genre.archived).map((genre) => (
                <label key={genre.id} className="admin-check">
                  <input
                    type="checkbox"
                    checked={form.genreSlugs.includes(genre.slug)}
                    onChange={() => {
                      const next = form.genreSlugs.includes(genre.slug)
                        ? form.genreSlugs.filter((slug) => slug !== genre.slug)
                        : [...form.genreSlugs, genre.slug];
                      setField('genreSlugs', next);
                    }}
                  />
                  {genre.name}
                </label>
              ))}
            </fieldset>
            <label>Countries<textarea value={form.countryCodes} onChange={(event) => setField('countryCodes', event.target.value)} rows={2} /></label>
            <label>Alternate titles<textarea value={form.alternateTitles} onChange={(event) => setField('alternateTitles', event.target.value)} rows={3} /></label>
            <label>Collection
              <select value={form.collectionId} onChange={(event) => setField('collectionId', event.target.value)}>
                <option value="">None</option>
                {(collections.data?.data || []).map((collection) => (
                  <option key={collection.id} value={collection.id}>{collection.name}</option>
                ))}
              </select>
            </label>
            <button type="submit">Save metadata</button>
          </form>
          <section>
            <h2>Images</h2>
            {movie.images.length ? movie.images.map((image) => (
              <p key={image.id}>{image.type}: {image.width || '—'}×{image.height || '—'} · {image.usable ? 'Usable' : 'Needs a secure image with dimensions'} · {image.url}</p>
            )) : <p className="admin-note">No images.</p>}
            <h2>Trailers</h2>
            {movie.videos.length ? movie.videos.map((video) => <p key={video.id}>{video.type}: {video.url}</p>) : <p className="admin-note">No trailers.</p>}
            <h2>External identifiers</h2>
            {movie.identifiers?.length ? movie.identifiers.map((item) => <p key={`${item.source}-${item.externalId}`}>{item.source}: {item.externalId}</p>) : <p className="admin-note">No external identifiers.</p>}
            <h2>Cast</h2>
            {movie.cast?.length ? movie.cast.map((person) => <p key={`${person.name}-${person.character}`}>{person.name}{person.character ? ` as ${person.character}` : ''}</p>) : <p className="admin-note">No cast records.</p>}
            <h2>Crew</h2>
            {movie.crew?.length ? movie.crew.map((person) => <p key={`${person.name}-${person.job}`}>{person.name} · {person.job}</p>) : <p className="admin-note">No crew records.</p>}
            <h2>Media references</h2>
            {movie.media?.length ? movie.media.map((item) => (
              <p key={item.id}>{item.type} · {item.quality || 'unspecified'} · availability {item.availability} · rights {item.rights}</p>
            )) : <p className="admin-note">No media references. Rights stay unchanged here.</p>}
          </section>
        </>
      ) : null}
    </>
  );
}
