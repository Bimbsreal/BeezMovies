'use client';

import { useState } from 'react';
import { api } from '../../lib/api/client';
import { Feedback, useResource } from './admin-ui';

export function ContentTypesView() {
  const state = useResource('/admin/content-types');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [label, setLabel] = useState({});
  const types = state.data?.data || [];
  const labels = state.data?.labels || [];
  const report = state.data?.report;

  async function toggle(row) {
    setMessage('');
    setError('');
    try {
      await api(`/admin/content-types/${row.id}`, {
        method: 'POST',
        body: { active: !row.active, confirm: true },
      });
      setMessage(`${row.name} is now ${row.active ? 'inactive' : 'active'}.`);
      state.reload();
    } catch (cause) {
      setError(cause.message || 'Update failed');
    }
  }

  async function override(event, row) {
    event.preventDefault();
    setMessage('');
    setError('');
    try {
      await api(`/admin/industry-labels/${row.id}`, {
        method: 'POST',
        body: { label: label[row.id] || '', confirm: true },
      });
      setLabel((current) => ({ ...current, [row.id]: '' }));
      setMessage(`Label updated for ${row.country.displayName}.`);
      state.reload();
    } catch (cause) {
      setError(cause.message || 'Label was not updated');
    }
  }

  return (
    <>
      <h1>Content types</h1>
      <p className="admin-note">Labels are derived from country and content type. Movie and series are separate. No seasons or episodes are published until an approved source provides them.</p>
      <Feedback message={message} error={error} />
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Published</th>
            <th>Active</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {types.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td>{row.published}</td>
              <td>{row.active ? 'Yes' : 'No'}</td>
              <td><button type="button" onClick={() => toggle(row)}>{row.active ? 'Deactivate' : 'Activate'}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Country and type</h2>
      {report?.sourceNote ? <p className="admin-note">{report.sourceNote}</p> : null}
      <table>
        <thead>
          <tr>
            <th>Country</th>
            <th>Content type</th>
            <th>Published</th>
          </tr>
        </thead>
        <tbody>
          {(report?.countries || []).flatMap((country) => country.types.map((type) => (
            <tr key={`${country.code}-${type.code}`}>
              <td>{country.country}</td>
              <td>{type.name}</td>
              <td>{type.published}</td>
            </tr>
          )))}
        </tbody>
      </table>
      <h2>Industry labels</h2>
      <table>
        <thead>
          <tr>
            <th>Country</th>
            <th>Type</th>
            <th>Label</th>
            <th>Origin</th>
            <th>Published</th>
            <th>Override</th>
          </tr>
        </thead>
        <tbody>
          {labels.map((row) => (
            <tr key={row.id}>
              <td>{row.country.displayName}</td>
              <td>{row.contentType.name}</td>
              <td>{row.label}</td>
              <td>{row.origin}</td>
              <td>{row.published}</td>
              <td>
                <form onSubmit={(event) => override(event, row)}>
                  <input
                    value={label[row.id] || ''}
                    onChange={(event) => setLabel((current) => ({ ...current, [row.id]: event.target.value }))}
                    aria-label={`Override ${row.label}`}
                  />
                  <button type="submit">Save</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(state.data?.reviews || []).length > 0 ? (
        <>
          <h2>Classification review</h2>
          <ul>
            {state.data.reviews.map((row) => (
              <li key={`${row.field}-${row.reason}-${row.slug || row.raw || 'open'}`}>{row.field} · {row.reason}{row.slug ? ` · ${row.slug}` : ''}</li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
