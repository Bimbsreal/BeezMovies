'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api/client';
import { Feedback, Notice, useResource } from './admin-ui';

function OperationsForms({ data, onSaved, onError }) {
  const [maintenance, setMaintenance] = useState(Boolean(data.maintenance?.enabled));
  const [maintenanceMessage, setMaintenanceMessage] = useState(data.maintenance?.message || '');
  const [flags, setFlags] = useState(data.flags || { ingestion: true, searchIndexing: true, advertising: true });
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    setMaintenance(Boolean(data.maintenance?.enabled));
    setMaintenanceMessage(data.maintenance?.message || '');
    setFlags(data.flags || { ingestion: true, searchIndexing: true, advertising: true });
  }, [data]);

  async function submit(event) {
    event.preventDefault();
    onError('');
    if (!confirm) {
      onError('Confirm the operational change before saving.');
      return;
    }
    try {
      await api('/admin/operations', {
        method: 'PATCH',
        body: {
          confirm: true,
          maintenance: { enabled: maintenance, message: maintenanceMessage },
          flags,
        },
      });
      setConfirm(false);
      onSaved();
    } catch (cause) {
      onError(cause.message || 'Save failed');
    }
  }

  return (
    <form className="admin-form" onSubmit={submit}>
      <label>
        Maintenance message
        <textarea value={maintenanceMessage} onChange={(event) => setMaintenanceMessage(event.target.value)} maxLength={180} rows={2} />
      </label>
      <label><input type="checkbox" checked={maintenance} onChange={(event) => setMaintenance(event.target.checked)} /> Maintenance mode</label>
      <label><input type="checkbox" checked={flags.ingestion !== false} onChange={(event) => setFlags({ ...flags, ingestion: event.target.checked })} /> Ingestion</label>
      <label><input type="checkbox" checked={flags.searchIndexing !== false} onChange={(event) => setFlags({ ...flags, searchIndexing: event.target.checked })} /> Search indexing</label>
      <label><input type="checkbox" checked={flags.advertising === true} onChange={(event) => setFlags({ ...flags, advertising: event.target.checked })} /> Advertising placements allowed</label>
      <label><input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} /> Confirm operational change</label>
      <button type="submit">Save operations</button>
    </form>
  );
}

export function SystemView() {
  const state = useResource('/admin/system');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const data = state.data?.data;
  const current = data?.settings?.find((item) => item.key === 'ops_note')?.value?.text || '';

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
      <h1>System</h1>
      <Notice state={state} />
      {data ? (
        <>
          <dl className="admin-detail">
            <div><dt>Release</dt><dd>{data.release}</dd></div>
            {(data.checks || []).map((item) => (
              <div key={`${item.group}-${item.name}`}>
                <dt>{item.group} · {item.name}</dt>
                <dd>{item.status}{item.detail ? ` · ${item.detail}` : ''}</dd>
              </div>
            ))}
          </dl>
          {data.alerts?.length ? (
            <ul>
              {data.alerts.map((alert) => (
                <li key={alert.code}>{alert.severity}: {alert.message}</li>
              ))}
            </ul>
          ) : null}
          <OperationsForms data={data} onSaved={() => { setMessage('Operations updated.'); state.reload(); }} onError={setError} />
          <form className="admin-form" onSubmit={save}>
            <label>Operations note<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={280} rows={3} /></label>
            <button type="submit">Save note</button>
          </form>
          <Feedback message={message} error={error} />
        </>
      ) : null}
    </>
  );
}
