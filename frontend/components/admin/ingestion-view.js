'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api/client';
import { Feedback, Notice, formatWhen, runConfirmed, useResource } from './admin-ui';

export function IngestionView() {
  const jobs = useResource('/admin/ingestion/jobs?limit=40');
  const sources = useResource('/admin/ingestion/sources');
  const metrics = useResource('/admin/ingestion/metrics');
  const [source, setSource] = useState('development-metadata');
  const [externalId, setExternalId] = useState('');
  const [batch, setBatch] = useState('');
  const [movieId, setMovieId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const counts = metrics.data?.data;
  const rows = jobs.data?.data || [];
  const sourceRows = sources.data?.data?.sources || [];

  async function start(event) {
    event.preventDefault();
    setMessage('');
    setError('');
    if (externalId.includes('/') || externalId.includes('://')) {
      setError('Ingestion accepts a source slug and external id, not a URL.');
      return;
    }
    const body = { source };
    if (externalId) body.externalId = externalId;
    try {
      await api('/admin/ingestion/jobs', { method: 'POST', body });
      setMessage('Ingestion queued.');
      jobs.reload();
    } catch (cause) {
      setError(cause.message || 'Ingestion failed');
    }
  }

  async function retry(row) {
    setMessage('');
    setError('');
    const result = await runConfirmed(`Retry job ${row.id}?`, () => api(`/admin/ingestion/jobs/${row.id}/retry`, {
      method: 'POST',
      body: {},
    }));
    if (result.cancelled) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage('Job returned to pending.');
    jobs.reload();
  }

  async function cancel(row) {
    const result = await runConfirmed(`Cancel job ${row.id}?`, () => api(`/admin/ingestion/jobs/${row.id}/cancel`, {
      method: 'POST',
      body: { confirm: true },
    }));
    if (result.cancelled) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage('Job cancelled.');
    jobs.reload();
    metrics.reload();
  }

  async function retryFailed() {
    const result = await runConfirmed('Return up to 25 failed jobs to the queue?', () => api('/admin/ingestion/retry-failed', {
      method: 'POST',
      body: { confirm: true },
    }));
    if (result.cancelled) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(`Retried ${result.data.data.retried} failed jobs.`);
    jobs.reload();
    metrics.reload();
  }

  async function maintain(event) {
    event.preventDefault();
    const action = event.nativeEvent.submitter?.value;
    if (!/^[0-9a-f-]{36}$/i.test(movieId)) {
      setError('Enter the movie id to validate or reindex.');
      return;
    }
    const path = action === 'reindex' ? '/admin/ingestion/reindex' : '/admin/ingestion/validate';
    const result = await runConfirmed(action === 'reindex' ? 'Reindex this movie?' : 'Run validation for this movie?', () => api(path, {
      method: 'POST',
      body: { confirm: true, movieId },
    }));
    if (result.cancelled) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const data = result.data.data;
    setMessage(action === 'reindex' ? 'Movie reindexed.' : (data.ready ? 'Validation passed.' : `Review: ${data.issues.join(', ')}`));
  }

  async function queue(enabled) {
    const result = await runConfirmed(enabled ? 'Resume ingestion?' : 'Pause ingestion?', () => api('/admin/ingestion/queue', {
      method: 'POST',
      body: { confirm: true, enabled },
    }));
    if (result.cancelled) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(enabled ? 'Ingestion resumed.' : 'Ingestion paused.');
  }

  async function startBatch(event) {
    event.preventDefault();
    const externalIds = batch.split(/\s+/).map((item) => item.trim()).filter(Boolean);
    const result = await runConfirmed(`Queue ${externalIds.length} records? Maximum 25.`, () => api('/admin/ingestion/batches', {
      method: 'POST',
      body: { confirm: true, source, externalIds },
    }));
    if (result.cancelled) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const summary = result.data.data;
    setMessage(`Batch ${summary.total}: queued ${summary.successful}, skipped ${summary.skipped}, failed ${summary.failed}.`);
    jobs.reload();
    metrics.reload();
  }

  return (
    <>
      <h1>Ingestion</h1>
      {counts ? (
        <p>
          Queued {counts.queued} · Running {counts.running} · Completed {counts.completed}
          {' '}· Failed {counts.failed} · Retrying {counts.retrying} · Dead letter {counts.deadLetter}
          {' '}· {counts.throughput} completed today
        </p>
      ) : null}
      <p>
        <button type="button" onClick={() => queue(false)}>Pause queue</button>
        {' '}
        <button type="button" onClick={() => queue(true)}>Resume queue</button>
        {' '}
        <button type="button" onClick={retryFailed}>Retry failed</button>
      </p>
      <form className="admin-filters" onSubmit={maintain}>
        <label>Movie id
          <input value={movieId} onChange={(event) => setMovieId(event.target.value)} />
        </label>
        <button type="submit" name="action" value="validate">Run validation</button>
        <button type="submit" name="action" value="reindex">Reindex</button>
      </form>
      <form className="admin-filters" onSubmit={start}>
        <label>Source
          <select value={source} onChange={(event) => setSource(event.target.value)}>
            {sourceRows.map((item) => (
              <option key={item.slug} value={item.slug}>{item.name} ({item.status})</option>
            ))}
          </select>
        </label>
        <label>External id<input value={externalId} onChange={(event) => setExternalId(event.target.value)} /></label>
        <button type="submit">Start ingestion</button>
      </form>
      <form className="admin-filters" onSubmit={startBatch}>
        <label>Batch ids
          <textarea value={batch} onChange={(event) => setBatch(event.target.value)} rows={3} placeholder="One external id per line, 25 maximum" />
        </label>
        <button type="submit">Queue batch</button>
      </form>
      <Feedback message={message} error={error} />
      <Notice state={jobs} empty={jobs.status === 'ready' && rows.length === 0} />
      {rows.length ? (
        <table className="admin-table">
          <thead>
            <tr><th>Job</th><th>Source</th><th>External id</th><th>State</th><th>Attempts</th><th>Created</th><th>Error</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td><Link href={`/admin/ingestion/${row.id}`}>{row.operation}</Link></td>
                <td>{row.source}</td>
                <td>{row.externalId || '—'}</td>
                <td>{row.state || row.status}</td>
                <td>{row.attemptCount}/{row.maxAttempts}</td>
                <td>{formatWhen(row.createdAt)}</td>
                <td>{row.errorCode || '—'}</td>
                <td>
                  {row.status === 'failed' || row.status === 'dead_letter' ? <button type="button" onClick={() => retry(row)}>Retry</button> : null}
                  {row.status === 'pending' || row.status === 'failed' ? <button type="button" onClick={() => cancel(row)}>Cancel</button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}

export function IngestionJobView({ id }) {
  const state = useResource(id ? `/admin/ingestion/jobs/${id}` : null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const job = state.data?.data;

  async function retry() {
    setMessage('');
    setError('');
    const result = await runConfirmed('Retry this job?', () => api(`/admin/ingestion/jobs/${id}/retry`, {
      method: 'POST',
      body: {},
    }));
    if (result.cancelled) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage('Job returned to pending.');
    state.reload();
  }

  return (
    <>
      <p><Link href="/admin/ingestion">Ingestion</Link></p>
      <h1>Job</h1>
      <Notice state={state} />
      <Feedback message={message} error={error} />
      {job ? (
        <dl className="admin-detail">
          <div><dt>Job ID</dt><dd>{job.id}</dd></div>
          <div><dt>Source</dt><dd>{job.source}</dd></div>
          <div><dt>Job type</dt><dd>{job.jobType}</dd></div>
          <div><dt>Movie</dt><dd>{job.movieSlug || job.movieId || '—'}</dd></div>
          <div><dt>External ID</dt><dd>{job.externalId || '—'}</dd></div>
          <div><dt>State</dt><dd>{job.state || job.status}</dd></div>
          <div><dt>Attempts</dt><dd>{job.attemptCount}/{job.maxAttempts}</dd></div>
          <div><dt>Created</dt><dd>{formatWhen(job.createdAt)}</dd></div>
          <div><dt>Started</dt><dd>{formatWhen(job.startedAt)}</dd></div>
          <div><dt>Completed</dt><dd>{formatWhen(job.completedAt)}</dd></div>
          <div><dt>Error category</dt><dd>{job.errorCode || '—'}</dd></div>
          <div><dt>Error message</dt><dd>{job.errorMessage || '—'}</dd></div>
        </dl>
      ) : null}
      {job && (job.status === 'failed' || job.status === 'dead_letter') ? (
        <button type="button" onClick={retry}>Retry</button>
      ) : null}
    </>
  );
}
