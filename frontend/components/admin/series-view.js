'use client';

import { statusLabel, useResource } from './admin-ui';

export function SeriesView() {
  const state = useResource('/admin/series');
  const rows = state.data?.data || [];

  return (
    <>
      <h1>Series</h1>
      <p className="admin-note">Published series, seasons, and episodes come from approved sources. This list stays empty when the catalog has no episodic records.</p>
      {state.status === 'loading' ? <p>Loading series.</p> : null}
      {state.status === 'denied' ? <p role="alert">Sign in with catalog access to inspect series.</p> : null}
      {state.status === 'error' ? <p role="alert">{state.error}</p> : null}
      {state.status === 'ready' && rows.length === 0 ? <p>No series records are in the catalog.</p> : null}
      {rows.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Series</th>
              <th>Status</th>
              <th>Country</th>
              <th>Language</th>
              <th>Seasons</th>
              <th>Episodes</th>
              <th>Authorized media</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.slug}>
                <td>{row.title}{row.releaseYear ? ` (${row.releaseYear})` : ''}</td>
                <td>{statusLabel(row.status)}</td>
                <td>{row.countries || '—'}</td>
                <td>{row.language || '—'}</td>
                <td>{row.seasons}</td>
                <td>{row.episodes}</td>
                <td>{row.authorizedMedia}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
