'use client';

import { useState } from 'react';
import { api } from '../../lib/api/client';
import { useAuth } from '../auth/auth-provider';
import { Feedback, Notice, formatWhen, runConfirmed, useResource } from './admin-ui';

const ROLE_OPTIONS = ['user', 'admin', 'super_admin', 'content_admin', 'moderator'];

export function UsersView() {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const state = useResource(applied ? `/admin/users?q=${encodeURIComponent(applied)}` : '/admin/users');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const rows = state.data?.data || [];
  const canChangeRoles = Boolean(user?.roles?.includes('super_admin'));

  async function setStatus(row, accountStatus) {
    setMessage('');
    setError('');
    const result = await runConfirmed(
      accountStatus === 'suspended' ? `Deactivate ${row.email}?` : `Activate ${row.email}?`,
      () => api(`/admin/users/${row.id}`, { method: 'PATCH', body: { accountStatus, confirm: true } }),
    );
    if (result.cancelled) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage('Account status updated.');
    state.reload();
  }

  async function setRoles(row) {
    const selected = ROLE_OPTIONS.filter((role) => document.getElementById(`role-${row.id}-${role}`)?.checked);
    if (!selected.length) {
      setError('Choose at least one role.');
      return;
    }
    setMessage('');
    setError('');
    const result = await runConfirmed(`Change roles for ${row.email}?`, () => api(`/admin/users/${row.id}/roles`, {
      method: 'POST',
      body: { roles: selected, confirm: true },
    }));
    if (result.cancelled) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage('Roles updated.');
    state.reload();
  }

  return (
    <>
      <h1>Users</h1>
      <form className="admin-filters" onSubmit={(event) => { event.preventDefault(); setApplied(query.trim()); }}>
        <label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <button type="submit">Apply</button>
      </form>
      <Feedback message={message} error={error} />
      <Notice state={state} empty={state.status === 'ready' && rows.length === 0} />
      {rows.length ? (
        <table className="admin-table">
          <thead><tr><th>Email</th><th>Name</th><th>Status</th><th>Roles</th><th>Created</th><th>Last sign-in</th><th>Actions</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.email}</td>
                <td>{row.displayName}</td>
                <td>{row.accountStatus}</td>
                <td key={row.roles.join(',')}>
                  {canChangeRoles && row.id !== user.id ? ROLE_OPTIONS.map((role) => (
                    <label key={role} className="admin-check">
                      <input id={`role-${row.id}-${role}`} type="checkbox" defaultChecked={row.roles.includes(role)} />
                      {role}
                    </label>
                  )) : row.roles.join(', ')}
                </td>
                <td>{formatWhen(row.createdAt)}</td>
                <td>{formatWhen(row.lastLoginAt)}</td>
                <td>
                  {row.accountStatus === 'active' ? (
                    <button type="button" onClick={() => setStatus(row, 'suspended')} disabled={row.id === user.id}>Deactivate</button>
                  ) : (
                    <button type="button" onClick={() => setStatus(row, 'active')}>Activate</button>
                  )}
                  {canChangeRoles && row.id !== user.id ? <button type="button" onClick={() => setRoles(row)}>Save roles</button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
