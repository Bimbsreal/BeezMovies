'use client';

import { useState } from 'react';
import { api } from '../../lib/api/client';
import { Feedback, Notice, useResource } from './admin-ui';

function Queue({ title, rows, render }) {
  return (
    <section>
      <h2>{title}</h2>
      {rows.length === 0 ? <p className="admin-note">None waiting.</p> : (
        <ul>{rows.map((row, index) => <li key={`${render.key(row)}-${index}`}>{render.label(row)}</li>)}</ul>
      )}
    </section>
  );
}

export function ReviewView() {
  const state = useResource('/admin/review');
  const board = useResource('/admin/editorial');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const rows = state.data?.data || [];

  async function decide(id, action) {
    setMessage('');
    setError('');
    try {
      await api(`/admin/review/${id}`, { method: 'POST', body: { action, confirm: true } });
      setMessage(action === 'reject' ? 'Candidate rejected. The movies were not merged.' : 'Candidate kept as separate movies.');
      state.reload();
    } catch (cause) {
      setError(cause.message || 'Review failed');
    }
  }

  return (
    <>
      <h1>Review</h1>
      <p>Similar titles stay separate until an administrator confirms a merge from the movie record.</p>
      <Notice state={board} />
      {board.data?.data ? (
        <>
          <Queue title="Missing metadata" rows={board.data.data.missingMetadata} render={{ key: (row) => row.slug, label: (row) => `${row.title} · ${row.slug}` }} />
          <Queue title="Country conflicts" rows={board.data.data.countryConflicts} render={{ key: (row) => `${row.code}-${row.reason}`, label: (row) => `${row.code} · ${row.reason}` }} />
          <Queue title="Classification" rows={board.data.data.classification || []} render={{ key: (row) => `${row.field}-${row.reason}-${row.slug || row.raw || ''}`, label: (row) => `${row.field} · ${row.reason}${row.slug ? ` · ${row.slug}` : ''}` }} />
          <Queue title="Duplicate candidates" rows={board.data.data.duplicateCandidates} render={{ key: (row) => `${row.slug}-${row.externalId}`, label: (row) => `${row.slug} · ${row.externalId}` }} />
          <Queue title="Language conflicts" rows={board.data.data.languageConflicts} render={{ key: (row) => row.slug, label: (row) => `${row.title} has no original language` }} />
          <Queue title="Artwork" rows={board.data.data.artwork} render={{ key: (row) => row.slug, label: (row) => `${row.title} needs a usable poster` }} />
          <Queue title="Media and rights" rows={board.data.data.providerFailures} render={{ key: (row) => `${row.slug}-${row.rights}`, label: (row) => `${row.slug} · rights ${row.rights} · ${row.availability}` }} />
          <Queue title="Takedown cases" rows={board.data.data.takedowns} render={{ key: (row) => row.caseCode, label: (row) => `${row.caseCode} · ${row.status} · ${row.slug}` }} />
        </>
      ) : null}
      <Notice state={state} />
      <Feedback message={message} error={error} />
      {rows.length === 0 && state.status === 'ready' ? <p>No pending duplicate candidates.</p> : null}
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            {row.movie.title}{row.movie.releaseYear ? ` (${row.movie.releaseYear})` : ''} · {row.externalId}
            <button type="button" onClick={() => decide(row.id, 'approve')}>Approve</button>
            <button type="button" onClick={() => decide(row.id, 'reject')}>Reject</button>
          </li>
        ))}
      </ul>
    </>
  );
}
