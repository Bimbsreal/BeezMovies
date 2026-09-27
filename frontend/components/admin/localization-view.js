'use client';

import { useState } from 'react';
import { api } from '../../lib/api/client';
import { Feedback, useResource } from './admin-ui';

export function LocalizationView() {
  const state = useResource('/admin/localization');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const rows = state.data?.data || [];

  async function setStatus(id, status) {
    setMessage('');
    setError('');
    try {
      await api(`/admin/localization/titles/${id}`, { method: 'POST', body: { status, confirm: true } });
      setMessage('Title status updated.');
      state.reload();
    } catch (cause) {
      setError(cause.message || 'Update failed');
    }
  }

  return (
    <>
      <h1>Localization</h1>
      <p className="admin-note">Source titles and synopses stay in place. A translation is public only when its status is verified.</p>
      <Feedback message={message} error={error} />
      <table>
        <thead>
          <tr>
            <th>Movie</th>
            <th>Original language</th>
            <th>Languages</th>
            <th>Titles</th>
            <th>Synopsis</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.slug}>
              <td>
                {row.title}
                {row.originalTitle ? <p>Original: {row.originalTitle}</p> : null}
              </td>
              <td>{row.originalLanguage?.name || 'Unavailable'}</td>
              <td>{(row.languages || []).join(', ') || 'Unavailable'}</td>
              <td>
                {(row.titles || []).map((title) => (
                  <p key={title.id}>
                    {title.title} · {title.language || 'No language'} · {title.status}
                    {title.status !== 'verified' ? (
                      <button type="button" className="ml-2 min-h-11" onClick={() => setStatus(title.id, 'verified')} aria-label={`Verify ${title.title}`}>Verify</button>
                    ) : (
                      <button type="button" className="ml-2 min-h-11" onClick={() => setStatus(title.id, 'unavailable')} aria-label={`Hide ${title.title}`}>Hide</button>
                    )}
                  </p>
                ))}
              </td>
              <td>Source {row.synopsis.source}. Localized {row.synopsis.localized}.</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
