'use client';

import { useState } from 'react';
import { api } from '../../lib/api/client';
import { Feedback, formatWhen, runConfirmed, useResource } from './admin-ui';

export function SyncView() {
  const state = useResource('/admin/ingestion/sync');
  const [source, setSource] = useState('development-metadata');
  const [mode, setMode] = useState('manual');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const board = state.data?.data;
  const current = board?.current;
  const last = board?.last;

  async function run(path, prompt) {
    setMessage('');
    setError('');
    const result = await runConfirmed(prompt, () => api(path, {
      method: 'POST',
      body: path.endsWith('/sync')
        ? { confirm: true, source, mode }
        : { confirm: true },
    }));
    if (result.cancelled) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage('Synchronization updated.');
    state.reload();
  }

  return (
    <>
      <h1>Synchronization</h1>
      <p className="admin-note">Approved sources are scanned from a saved checkpoint. Unchanged records are not imported again. Catalog sync does not create downloadable media.</p>
      <Feedback message={message} error={error} />
      {state.status === 'loading' ? <p>Loading synchronization.</p> : null}
      {state.status === 'denied' ? <p role="alert">Sign in with catalog access to run synchronization.</p> : null}
      {board?.alerts?.map((alert) => <p key={alert} role="alert">{alert}</p>)}
      <dl>
        <dt>Current sync</dt>
        <dd>{current ? `${current.status} · ${current.mode} · ${current.source}` : 'Idle'}</dd>
        <dt>Last sync</dt>
        <dd>{last ? `${formatWhen(last.finishedAt || last.startedAt)} · ${last.status}` : 'None recorded'}</dd>
        <dt>Queue depth</dt>
        <dd>{board?.queueDepth ?? '—'}</dd>
        <dt>Failure rate</dt>
        <dd>{board ? `${board.failureRate}%` : '—'}</dd>
      </dl>
      {last ? (
        <table>
          <thead>
            <tr>
              <th>Discovered</th>
              <th>Created</th>
              <th>Updated</th>
              <th>Unchanged</th>
              <th>Duplicates</th>
              <th>Rejected</th>
              <th>Review</th>
              <th>Failed</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{last.discovered}</td>
              <td>{last.created}</td>
              <td>{last.updated}</td>
              <td>{last.unchanged}</td>
              <td>{last.duplicates}</td>
              <td>{last.rejected}</td>
              <td>{last.review}</td>
              <td>{last.failed}</td>
            </tr>
          </tbody>
        </table>
      ) : null}
      {last?.note ? <p className="admin-note">{last.note}</p> : null}
      <form className="admin-form" onSubmit={(event) => {
        event.preventDefault();
        run('/admin/ingestion/sync', 'Start a synchronization for this source? This queues changed records only.');
      }}>
        <label>
          Source
          <input value={source} onChange={(event) => setSource(event.target.value)} />
        </label>
        <label>
          Mode
          <select value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="manual">Manual</option>
            <option value="initial">Initial</option>
            <option value="incremental">Incremental</option>
          </select>
        </label>
        <button type="submit">Start sync</button>
      </form>
      {current ? (
        <p>
          <button type="button" onClick={() => run(`/admin/ingestion/sync/${current.id}/pause`, 'Pause this synchronization?')}>Pause</button>
          <button type="button" onClick={() => run(`/admin/ingestion/sync/${current.id}/resume`, 'Resume this synchronization?')}>Resume</button>
          <button type="button" onClick={() => run(`/admin/ingestion/sync/${current.id}/cancel`, 'Cancel this synchronization?')}>Cancel</button>
        </p>
      ) : null}
      <p>
        <button type="button" onClick={() => run('/admin/ingestion/sync/retry', 'Retry up to 25 failed ingestion jobs?')}>Retry failed</button>
      </p>
      <h2>Checkpoints</h2>
      {(board?.checkpoints || []).length === 0 ? <p>No source checkpoint is stored yet.</p> : (
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Cursor</th>
              <th>Page</th>
              <th>Last success</th>
              <th>Failure position</th>
            </tr>
          </thead>
          <tbody>
            {board.checkpoints.map((row) => (
              <tr key={row.source}>
                <td>{row.source}</td>
                <td>{row.cursor}</td>
                <td>{row.page}</td>
                <td>{row.lastSuccessExternalId || '—'}</td>
                <td>{row.failurePosition ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="admin-note">{board?.health?.mediaNote}</p>
      <p className="admin-note">{board?.schedules?.incremental}</p>
    </>
  );
}
