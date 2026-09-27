'use client';

import { useState } from 'react';
import { api } from '../../lib/api/client';
import { Feedback, Notice, useResource } from './admin-ui';

export function BootstrapView() {
  const state = useResource('/admin/ingestion/bootstrap');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const data = state.data?.data;
  const run = data?.run;

  async function post(path, body = { confirm: true }) {
    setMessage('');
    setError('');
    try {
      await api(path, { method: 'POST', body });
      setMessage('Bootstrap updated.');
      state.reload();
    } catch (cause) {
      setError(cause.message || 'Bootstrap request failed');
    }
  }

  return (
    <>
      <h1>Catalog bootstrap</h1>
      <Notice state={state} />
      {data ? (
        <>
          <p className="admin-note">
            Source {data.source?.provider || 'unavailable'} · {data.source?.authentication || 'none'} · attribution {data.source?.attribution || '—'}
          </p>
          <p className="admin-note">
            Production seed is blocked. {data.safety?.reasons?.join(' ') || 'Safety checks have not passed.'}
          </p>
          <dl className="admin-detail">
            <div><dt>Discovered</dt><dd>{run?.discovered ?? 0}</dd></div>
            <div><dt>Processed</dt><dd>{run?.processed ?? 0}</dd></div>
            <div><dt>Valid</dt><dd>{run?.valid ?? 0}</dd></div>
            <div><dt>Invalid</dt><dd>{run?.invalid ?? 0}</dd></div>
            <div><dt>Duplicates</dt><dd>{run?.duplicates ?? 0}</dd></div>
            <div><dt>Review</dt><dd>{run?.review ?? 0}</dd></div>
            <div><dt>Approved</dt><dd>{run?.approved ?? 0}</dd></div>
            <div><dt>Published</dt><dd>{run?.published ?? 0}</dd></div>
            <div><dt>Failed</dt><dd>{run?.failed ?? 0}</dd></div>
            <div><dt>Progress</dt><dd>{run ? `${run.progress}%` : '—'}</dd></div>
            <div><dt>Checkpoint</dt><dd>{run?.cursor ?? 0}</dd></div>
            <div><dt>Remaining</dt><dd>{run?.remaining ?? 0}</dd></div>
          </dl>
          <button type="button" onClick={() => post('/admin/ingestion/bootstrap/dry-run', { confirm: true, batchSize: 10 })}>Start dry run</button>
          {run && run.status === 'running' ? <button type="button" onClick={() => post(`/admin/ingestion/bootstrap/${run.id}/advance`)}>Process batch</button> : null}
          {run && run.status === 'running' ? <button type="button" onClick={() => post(`/admin/ingestion/bootstrap/${run.id}/pause`)}>Pause</button> : null}
          {run && run.status === 'paused' ? <button type="button" onClick={() => post(`/admin/ingestion/bootstrap/${run.id}/resume`)}>Resume</button> : null}
          {run && run.status !== 'completed' && run.status !== 'cancelled' ? <button type="button" onClick={() => post(`/admin/ingestion/bootstrap/${run.id}/cancel`)}>Cancel</button> : null}
          {run && run.status === 'failed' ? <button type="button" onClick={() => post(`/admin/ingestion/bootstrap/${run.id}/retry`)}>Retry</button> : null}
        </>
      ) : null}
      <Feedback message={message} error={error} />
    </>
  );
}
