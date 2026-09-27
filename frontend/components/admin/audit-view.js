'use client';

import { Notice, formatWhen, useResource } from './admin-ui';

export function AuditView() {
  const state = useResource('/admin/audit');
  const rows = state.data?.data || [];
  return (
    <>
      <h1>Audit</h1>
      <Notice state={state} empty={state.status === 'ready' && rows.length === 0} />
      {rows.length ? (
        <table className="admin-table">
          <thead>
            <tr><th>When</th><th>Administrator</th><th>Action</th><th>Target</th><th>Result</th><th>Metadata</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{formatWhen(row.createdAt)}</td>
                <td>{row.actorEmail}</td>
                <td>{row.action}</td>
                <td>{row.targetType}{row.targetId ? ` ${row.targetId}` : ''}</td>
                <td>{row.result}</td>
                <td>{Object.keys(row.metadata || {}).length ? JSON.stringify(row.metadata) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
