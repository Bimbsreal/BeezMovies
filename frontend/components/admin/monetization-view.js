'use client';

import { useState } from 'react';
import { api } from '../../lib/api/client';
import { Feedback, Notice, formatWhen, runConfirmed, useResource } from './admin-ui';

export function MonetizationView() {
  const state = useResource('/admin/monetization');
  const events = useResource('/admin/monetization/events');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [creative, setCreative] = useState({
    placement: 'IN_FEED_NATIVE',
    headline: '',
    body: '',
    href: '',
  });
  const data = state.data?.data;

  async function setProvider(provider, status) {
    setMessage('');
    setError('');
    const result = await runConfirmed(
      `${status === 'enabled' ? 'Enable' : 'Disable'} ${provider.name}?`,
      () => api(`/admin/monetization/providers/${provider.slug}`, {
        method: 'PATCH',
        body: { status, confirm: true },
      }),
    );
    if (result.cancelled) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage(result.payload.data.publicDelivery === 'active'
      ? 'Provider enabled for public delivery.'
      : 'Provider saved. Public delivery stays inactive until an official integration is verified.');
    state.reload();
  }

  async function setPlacement(placement, enabled) {
    setMessage('');
    setError('');
    const result = await runConfirmed(
      `${enabled ? 'Enable' : 'Disable'} ${placement.slug}?`,
      () => api(`/admin/monetization/placements/${placement.slug}`, {
        method: 'PATCH',
        body: {
          enabled,
          desktopEnabled: placement.desktopEnabled,
          mobileEnabled: placement.mobileEnabled,
          providerSlug: placement.providerSlug,
          priority: placement.priority,
          frequencyLimit: placement.frequencyLimit,
          minIntervalSeconds: placement.minIntervalSeconds,
          pageLimit: placement.pageLimit,
          confirm: true,
        },
      }),
    );
    if (result.cancelled) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessage('Placement updated.');
    state.reload();
  }

  async function saveCreative(event) {
    event.preventDefault();
    setMessage('');
    setError('');
    const body = {
      placement: creative.placement,
      headline: creative.headline,
      body: creative.body,
      confirm: true,
    };
    if (creative.href) body.href = creative.href;
    try {
      await api('/admin/monetization/creatives', { method: 'POST', body });
      setMessage('House creative saved. It appears only while its placement and provider are enabled.');
      setCreative({ ...creative, headline: '', body: '', href: '' });
      state.reload();
    } catch (cause) {
      setError(cause.message || 'Creative was not saved');
    }
  }

  return (
    <>
      <h1>Monetization</h1>
      <Notice state={state} />
      <Feedback message={message} error={error} />
      {data ? (
        <>
          <dl className="admin-detail">
            <div><dt>Impressions</dt><dd>{data.recorded.impressions}</dd></div>
            <div><dt>Clicks</dt><dd>{data.recorded.clicks}</dd></div>
            <div><dt>Completions</dt><dd>{data.recorded.completions}</dd></div>
            <div><dt>Failures</dt><dd>{data.recorded.failures}</dd></div>
            <div><dt>Affiliate events</dt><dd>{data.recorded.affiliateEvents}</dd></div>
            <div><dt>Estimated revenue</dt><dd>{data.estimatedRevenue}</dd></div>
          </dl>
          <h2>Providers</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th><th>Kind</th><th>Status</th><th>Integration</th><th>Credentials</th><th>Delivery</th><th>Targeting</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.providers.map((provider) => (
                <tr key={provider.slug}>
                  <td>{provider.name}</td>
                  <td>{provider.kind}</td>
                  <td>{provider.status}</td>
                  <td>{provider.integrationStatus}</td>
                  <td>{provider.credentials}</td>
                  <td>{provider.publicDelivery}</td>
                  <td>{provider.geographicTargeting} / {provider.deviceTargeting}</td>
                  <td>
                    {provider.status === 'enabled' ? (
                      <button type="button" onClick={() => setProvider(provider, 'disabled')}>Disable</button>
                    ) : (
                      <button type="button" onClick={() => setProvider(provider, 'enabled')}>Enable</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2>Placements</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Placement</th><th>Enabled</th><th>Desktop</th><th>Mobile</th><th>Priority</th><th>Frequency</th><th>Mode</th><th></th>
              </tr>
            </thead>
            <tbody>
              {data.placements.map((placement) => (
                <tr key={placement.slug}>
                  <td>{placement.slug}</td>
                  <td>{placement.enabled ? 'Yes' : 'No'}</td>
                  <td>{placement.desktopEnabled ? 'Yes' : 'No'}</td>
                  <td>{placement.mobileEnabled ? 'Yes' : 'No'}</td>
                  <td>{placement.priority}</td>
                  <td>{placement.frequencyLimit} / {placement.minIntervalSeconds}s</td>
                  <td>{placement.mode}</td>
                  <td>
                    <button type="button" onClick={() => setPlacement(placement, !placement.enabled)}>
                      {placement.enabled ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form className="admin-form" onSubmit={saveCreative}>
            <h2>House creative</h2>
            <label>Placement
              <select value={creative.placement} onChange={(event) => setCreative({ ...creative, placement: event.target.value })}>
                {data.placements.map((placement) => (
                  <option key={placement.slug} value={placement.slug}>{placement.slug}</option>
                ))}
              </select>
            </label>
            <label>Headline<input value={creative.headline} onChange={(event) => setCreative({ ...creative, headline: event.target.value })} required maxLength={80} /></label>
            <label>Body<textarea value={creative.body} onChange={(event) => setCreative({ ...creative, body: event.target.value })} required maxLength={180} rows={3} /></label>
            <label>HTTPS link<input value={creative.href} onChange={(event) => setCreative({ ...creative, href: event.target.value })} /></label>
            <button type="submit">Save creative</button>
          </form>
        </>
      ) : null}
      <h2>Events</h2>
      <Notice state={events} empty={events.status === 'ready' && (events.data?.data || []).length === 0} />
      {(events.data?.data || []).length ? (
        <table className="admin-table">
          <thead><tr><th>When</th><th>Type</th><th>Provider</th><th>Placement</th><th>Campaign</th></tr></thead>
          <tbody>
            {events.data.data.map((row) => (
              <tr key={row.id}>
                <td>{formatWhen(row.createdAt)}</td>
                <td>{row.type}</td>
                <td>{row.provider}</td>
                <td>{row.placement || '—'}</td>
                <td>{row.campaign || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </>
  );
}
