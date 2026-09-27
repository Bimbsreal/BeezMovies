'use client';

import { useState } from 'react';
import { api } from '../../lib/api/client';
import { Feedback, Notice, formatWhen, runConfirmed, useResource } from './admin-ui';

const SERVICES = [
  'APPLICATION', 'DATABASE', 'CACHE', 'QUEUE', 'WORKERS', 'SEARCH',
  'MEDIA PROVIDERS', 'CDN', 'PWA', 'BACKUPS', 'DOWNLOADS', 'SECURITY',
];

export function OperationsView() {
  const state = useResource('/admin/operations');
  const incidents = useResource('/admin/operations/incidents');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const data = state.data?.data;

  async function scan() {
    setMessage('');
    setError('');
    const result = await runConfirmed('Scan for new critical or high incidents?', async () => {
      await api('/admin/operations/incidents/scan', { method: 'POST', body: { confirm: true } });
    });
    if (result.ok) {
      setMessage('Incident scan finished.');
      incidents.reload();
      state.reload();
    } else if (!result.cancelled) setError(result.error || 'Scan failed');
  }

  async function queueQuality() {
    setMessage('');
    setError('');
    const result = await runConfirmed('Queue at most 10 artwork corrections?', async () => {
      const payload = await api('/admin/operations/quality', { method: 'POST', body: { confirm: true } });
      setMessage(`Queued ${payload.data.queued} of ${payload.data.examined} examined.`);
    });
    if (!result.ok && !result.cancelled) setError(result.error || 'Queue failed');
  }

  async function openIncident(event) {
    event.preventDefault();
    setMessage('');
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const payload = await api('/admin/operations/incidents', {
        method: 'POST',
        body: {
          confirm: true,
          severity: form.get('severity'),
          service: form.get('service'),
          summary: form.get('summary'),
        },
      });
      setMessage(`Opened ${payload.data.caseCode}.`);
      event.currentTarget.reset();
      incidents.reload();
    } catch (cause) {
      setError(cause.message || 'Incident was not opened');
    }
  }

  async function setStatus(id, status) {
    setMessage('');
    setError('');
    const note = window.prompt('Action taken') || '';
    const body = { confirm: true, status, note: note.length >= 2 ? note : undefined };
    if (status === 'POSTMORTEM') {
      body.impact = window.prompt('Impact') || '';
      body.cause = window.prompt('Cause') || '';
      body.mitigation = window.prompt('Mitigation') || '';
      body.prevention = window.prompt('Prevention') || '';
    }
    try {
      await api(`/admin/operations/incidents/${id}`, { method: 'POST', body });
      setMessage('Incident updated.');
      incidents.reload();
      state.reload();
    } catch (cause) {
      setError(cause.message || 'Update failed');
    }
  }

  return (
    <>
      <h1>Operations</h1>
      <Notice state={state} />
      {data ? (
        <>
          <p className="admin-note">Release {data.release.label} · {data.release.version} · migration {data.release.migration || 'unknown'} · not deployed</p>
          <dl className="admin-detail">
            {data.services.map((item) => (
              <div key={item.name}>
                <dt>{item.name}</dt>
                <dd>{item.status}</dd>
              </div>
            ))}
          </dl>
          <h2>Notifications</h2>
          {data.notifications.length ? (
            <ul>
              {data.notifications.map((item) => (
                <li key={item.id}>{item.severity}: {item.service} · {item.summary}</li>
              ))}
            </ul>
          ) : <p className="admin-note">No critical or high incidents are open.</p>}
          <h2>Catalog</h2>
          <p className="admin-note">
            Published {data.catalog?.catalog?.published ?? '—'} · missing posters {data.catalog?.artwork?.missingPosters ?? '—'} · duplicate candidates {data.catalog?.metadata?.duplicateCandidates ?? '—'} · stale media {data.catalog?.media?.stale ?? '—'}
          </p>
          <h2>Provider health</h2>
          {data.providerHealth?.length ? (
            <ul>
              {data.providerHealth.map((item) => (
                <li key={item.provider}>
                  {item.provider} · {item.status} · latency {item.latencyMs == null ? 'not measured' : `${item.latencyMs} ms`} · error rate {item.errorRate == null ? 'none' : `${item.errorRate}%`} · last success {formatWhen(item.lastSuccessAt)}
                </li>
              ))}
            </ul>
          ) : <p className="admin-note">No media providers are configured.</p>}
          {data.recentFailures?.length ? (
            <ul>
              {data.recentFailures.map((item) => (
                <li key={`${item.provider}-${item.movie}-${item.at}`}>{item.provider || 'unknown'} · {item.movie} · {item.failure || 'failed'} · {formatWhen(item.at)}</li>
              ))}
            </ul>
          ) : <p className="admin-note">No resolution failures in the last day. Viewer country is not stored.</p>}
          <h2>Search and downloads</h2>
          <p className="admin-note">
            Index pending {data.search.pending ?? '—'} · failed {data.search.failed ?? '—'} · zero-result searches {data.search.zeroResults} · download requests {data.downloads.requests} · failed {data.downloads.failed}
          </p>
          <h2>Database, backups, and security</h2>
          <p className="admin-note">
            Database {data.database.bytes == null ? 'size unavailable' : `${data.database.bytes} bytes`} · backups {data.backups.status} · login failures this hour {data.security.loginFailures}
          </p>
          <p className="admin-note">Compute, CDN, cache, and provider cost are not measured on this host. Slow-query statistics are not installed.</p>
          <button type="button" onClick={scan}>Scan for incidents</button>
          <button type="button" onClick={queueQuality}>Queue artwork corrections</button>
        </>
      ) : null}
      <h2>Incidents</h2>
      <Notice state={incidents} />
      <ul>
        {(incidents.data?.data || []).map((item) => (
          <li key={item.id}>
            {item.caseCode} · {item.severity} · {item.status} · {item.service} · {item.summary} · {formatWhen(item.startedAt)}
            {item.status !== 'POSTMORTEM' ? (
              <button type="button" onClick={() => setStatus(item.id, item.status === 'RESOLVED' ? 'POSTMORTEM' : 'RESOLVED')}>
                {item.status === 'RESOLVED' ? 'Postmortem' : 'Resolve'}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <form className="admin-form" onSubmit={openIncident}>
        <label>
          Severity
          <select name="severity" defaultValue="HIGH">
            <option>CRITICAL</option>
            <option>HIGH</option>
            <option>MEDIUM</option>
          </select>
        </label>
        <label>
          Service
          <select name="service" defaultValue="APPLICATION">
            {SERVICES.map((service) => <option key={service}>{service}</option>)}
          </select>
        </label>
        <label>
          Summary
          <input name="summary" minLength={8} maxLength={300} required />
        </label>
        <button type="submit">Open incident</button>
      </form>
      <Feedback message={message} error={error} />
    </>
  );
}
