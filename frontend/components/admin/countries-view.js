'use client';

import { useState } from 'react';
import { api } from '../../lib/api/client';
import { Feedback, useResource } from './admin-ui';

export function CountriesView() {
  const state = useResource('/admin/countries');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [alias, setAlias] = useState({});
  const rows = state.data?.data || [];
  const quality = state.data?.quality;
  const report = state.data?.report || [];

  async function toggle(row) {
    setMessage('');
    setError('');
    try {
      await api(`/admin/countries/${row.id}`, { method: 'PATCH', body: { active: !row.active } });
      setMessage(`${row.displayName} is now ${row.active ? 'hidden' : 'visible'}.`);
      state.reload();
    } catch (cause) {
      setError(cause.message || 'Update failed');
    }
  }

  async function addAlias(event, row) {
    event.preventDefault();
    setMessage('');
    setError('');
    try {
      await api(`/admin/countries/${row.id}/aliases`, {
        method: 'POST',
        body: { alias: alias[row.id] || '' },
      });
      setAlias((current) => ({ ...current, [row.id]: '' }));
      setMessage(`Alias added for ${row.displayName}.`);
      state.reload();
    } catch (cause) {
      setError(cause.message || 'Alias was not added');
    }
  }

  return (
    <>
      <h1>Countries</h1>
      <p className="admin-note">Country rows stay in place. Deactivate a country to hide it from public discovery. Movie links are not deleted from this screen.</p>
      {quality ? (
        <dl className="admin-detail">
          <div><dt>Missing country</dt><dd>{quality.missingCountry}</dd></div>
          <div><dt>Unknown country</dt><dd>{quality.unknownCountry}</dd></div>
          <div><dt>Invalid code</dt><dd>{quality.invalidCountry}</dd></div>
          <div><dt>Conflicting source</dt><dd>{quality.conflictingCountry}</dd></div>
          <div><dt>Duplicate relationships</dt><dd>{quality.duplicateRelationships}</dd></div>
        </dl>
      ) : null}
      <Feedback message={message} error={error} />
      <table>
        <thead>
          <tr>
            <th>Country</th>
            <th>Code</th>
            <th>Region</th>
            <th>Published</th>
            <th>Review</th>
            <th>Display</th>
            <th>Aliases</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const counts = report.find((item) => item.code === row.code);
            return (
              <tr key={row.id}>
                <td>{row.displayName}</td>
                <td>{row.code}</td>
                <td>{row.region}</td>
                <td>{counts ? counts.published : row.movieCount}</td>
                <td>{counts ? counts.review : 0}</td>
                <td>
                  <button type="button" onClick={() => toggle(row)}>{row.active ? 'Active' : 'Hidden'}</button>
                </td>
                <td>
                  <p>{row.aliases.join(', ') || 'None'}</p>
                  <form onSubmit={(event) => addAlias(event, row)}>
                    <input
                      aria-label={`Alias for ${row.displayName}`}
                      value={alias[row.id] || ''}
                      maxLength={80}
                      onChange={(event) => setAlias((current) => ({ ...current, [row.id]: event.target.value }))}
                    />
                    <button type="submit">Add alias</button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
