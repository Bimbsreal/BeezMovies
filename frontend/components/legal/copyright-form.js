'use client';

import { useState } from 'react';
import { api } from '../../lib/api/client';

export function CopyrightForm() {
  const [movieSlug, setMovieSlug] = useState('');
  const [summary, setSummary] = useState('');
  const [contact, setContact] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event) {
    event.preventDefault();
    setMessage('');
    setError('');
    try {
      const result = await api('/complaints', {
        method: 'POST',
        body: { movieSlug, summary, contact },
      });
      setMessage(`Received. Case ${result.data.caseCode}.`);
      setSummary('');
      setContact('');
    } catch (cause) {
      setError(cause.message || 'The complaint could not be sent.');
    }
  }

  return (
    <form className="mt-8 space-y-4" onSubmit={submit}>
      <label className="block text-sm">Movie slug
        <input className="mt-1 w-full rounded bg-elevated px-3 py-2" value={movieSlug} onChange={(event) => setMovieSlug(event.target.value)} />
      </label>
      <label className="block text-sm">What should be reviewed
        <textarea className="mt-1 w-full rounded bg-elevated px-3 py-2" rows={4} value={summary} onChange={(event) => setSummary(event.target.value)} />
      </label>
      <label className="block text-sm">Contact email
        <input className="mt-1 w-full rounded bg-elevated px-3 py-2" type="email" value={contact} onChange={(event) => setContact(event.target.value)} />
      </label>
      <button className="rounded bg-white px-4 py-2 text-sm text-black" type="submit">Submit complaint</button>
      {message ? <p className="text-sm">{message}</p> : null}
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </form>
  );
}
