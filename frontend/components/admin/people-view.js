'use client';

import { useState } from 'react';
import { Notice, useResource } from './admin-ui';

export function PeopleView() {
  const [draft, setDraft] = useState({ q: '', department: '' });
  const [query, setQuery] = useState(draft);
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.department) params.set('department', query.department);
  const state = useResource(`/admin/people?${params.toString()}`);
  const rows = state.data?.data || [];

  return (
    <>
      <h1>People</h1>
      <form className="admin-filters" onSubmit={(event) => { event.preventDefault(); setQuery(draft); }}>
        <label>Name<input value={draft.q} onChange={(event) => setDraft({ ...draft, q: event.target.value })} /></label>
        <label>Department<input value={draft.department} onChange={(event) => setDraft({ ...draft, department: event.target.value })} placeholder="Directing" /></label>
        <button type="submit">Filter</button>
      </form>
      <Notice state={state} empty={state.status === 'ready' && rows.length === 0} />
      {rows.length ? (
        <table className="admin-table">
          <thead><tr><th>Name</th><th>Departments</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{row.departments.join(', ') || '—'}</td>
                <td>{row.archived ? 'Archived' : 'Active'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
