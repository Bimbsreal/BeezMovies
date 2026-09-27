'use client';

import { useState } from 'react';
import { api } from '../../lib/api/client';
import { Feedback, Notice, formatWhen, runConfirmed, useResource } from './admin-ui';

const STATUSES = ['RECEIVED', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'REMOVED', 'REJECTED', 'RESOLVED'];

export function ComplaintsView() {
  const complaints = useResource('/admin/complaints');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const rows = complaints.data?.data || [];

  async function setStatus(row, status) {
    const result = await runConfirmed(`Set ${row.caseCode} to ${status}?`, () => api(`/admin/complaints/${row.id}`, {
      method: 'POST',
      body: { confirm: true, status },
    }));
    if (result.cancelled) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(`${row.caseCode} is ${status}.`);
    complaints.reload();
  }

  return (
    <>
      <h1>Complaints</h1>
      <p className="text-sm text-muted">Contact addresses stay on this screen. They are not shown on the public site.</p>
      <Feedback message={message} error={error} />
      <Notice state={complaints} empty={complaints.status === 'ready' && rows.length === 0} />
      {rows.length ? (
        <table className="admin-table">
          <thead>
            <tr><th>Case</th><th>Movie</th><th>Status</th><th>Summary</th><th>Contact</th><th>Received</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.caseCode}</td>
                <td>{row.movieTitle}</td>
                <td>{row.status}</td>
                <td>{row.summary}</td>
                <td>{row.contact}</td>
                <td>{formatWhen(row.createdAt)}</td>
                <td>
                  <select defaultValue={row.status} onChange={(event) => setStatus(row, event.target.value)}>
                    {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
