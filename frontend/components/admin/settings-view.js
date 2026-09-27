'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api/client';
import { Feedback, Notice, useResource } from './admin-ui';

const GROUPS = [
  ['General', 'Operations note. Secrets are not stored here.'],
  ['Catalog', 'Publication, genres, and collections.'],
  ['Search', 'Index jobs stay on the search screen.'],
  ['Media', 'Provider credentials stay in server configuration.'],
  ['PWA', 'Manifest, service worker, icons, and bee artwork.'],
  ['Monetization', 'Placements never start or replace a download.'],
  ['Security', 'Sessions, roles, and audit. Passwords are not shown.'],
  ['System', 'Maintenance and feature flags require confirmation.'],
];

export function SettingsView() {
  const state = useResource('/admin/system');
  const data = state.data?.data;
  const current = data?.settings?.find((item) => item.key === 'ops_note')?.value?.text || '';
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setNote(current);
  }, [current]);

  async function save(event) {
    event.preventDefault();
    setMessage('');
    setError('');
    try {
      await api('/admin/settings', { method: 'PATCH', body: { opsNote: note } });
      setMessage('Operations note saved.');
      state.reload();
    } catch (cause) {
      setError(cause.message || 'Save failed');
    }
  }

  return (
    <>
      <h1>Settings</h1>
      <Notice state={state} />
      {data ? (
        <>
          <dl className="admin-detail">
            {GROUPS.map(([title, detail]) => (
              <div key={title}>
                <dt>{title}</dt>
                <dd>{detail}</dd>
              </div>
            ))}
            <div><dt>Ingestion flag</dt><dd>{data.flags?.ingestion === false ? 'Disabled' : 'Enabled'}</dd></div>
            <div><dt>Search indexing</dt><dd>{data.flags?.searchIndexing === false ? 'Disabled' : 'Enabled'}</dd></div>
            <div><dt>Advertising</dt><dd>{data.flags?.advertising === true ? 'Enabled' : 'Disabled'}</dd></div>
            <div><dt>Maintenance</dt><dd>{data.maintenance?.enabled ? 'Enabled' : 'Disabled'}</dd></div>
          </dl>
          <section>
            <h2>PWA assets</h2>
            <ul>
              {(data.pwa?.assets || []).map((asset) => (
                <li key={asset.name}>{asset.name}: {asset.present ? 'Present' : 'Missing'}</li>
              ))}
            </ul>
            <p className="admin-note">{data.pwa?.removal}</p>
          </section>
          <p className="admin-actions">
            <Link href="/admin/movies">Catalog</Link>
            <Link href="/admin/search">Search</Link>
            <Link href="/admin/providers">Media providers</Link>
            <Link href="/admin/monetization">Monetization</Link>
            <Link href="/admin/system">System flags</Link>
          </p>
          <form className="admin-form" onSubmit={save}>
            <label>General · operations note
              <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={280} rows={3} />
            </label>
            <button type="submit">Save note</button>
          </form>
          <Feedback message={message} error={error} />
        </>
      ) : null}
    </>
  );
}
