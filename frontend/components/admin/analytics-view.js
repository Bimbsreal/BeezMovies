'use client';

import Link from 'next/link';
import { useState } from 'react';
import { publicConfig } from '../../lib/config';
import { Notice, useResource } from './admin-ui';

const PERIODS = [
  ['today', 'Today'],
  ['7d', '7 days'],
  ['30d', '30 days'],
  ['90d', '90 days'],
];

export function AnalyticsView({ section = 'overview' }) {
  const [period, setPeriod] = useState('7d');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const custom = period === 'custom' && from && to;
  const query = custom ? `period=custom&from=${from}&to=${to}` : `period=${period}`;
  const path = section === 'overview'
    ? `/admin/analytics?${query}`
    : `/admin/analytics/${section}?${query}`;
  const state = useResource(period === 'custom' && !custom ? null : path);
  const data = state.data?.data;

  async function downloadCsv() {
    const response = await fetch(`${publicConfig.apiUrl}/admin/analytics/export?${query}`, {
      credentials: 'include',
      headers: { 'X-BeezMovies-Request': '1' },
    });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'beezmovies-analytics.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <h1>Analytics</h1>
      <p className="admin-actions">
        <Link href="/admin/analytics">Overview</Link>
        <Link href="/admin/analytics/movies">Movies</Link>
        <Link href="/admin/analytics/search">Search</Link>
        <Link href="/admin/analytics/providers">Providers</Link>
        <button type="button" onClick={downloadCsv}>Export CSV</button>
      </p>
      <div className="admin-actions">
        {PERIODS.map(([value, label]) => (
          <button key={value} type="button" onClick={() => setPeriod(value)} disabled={period === value}>{label}</button>
        ))}
        <button type="button" onClick={() => setPeriod('custom')} disabled={period === 'custom'}>Custom</button>
      </div>
      {period === 'custom' ? (
        <form className="admin-filters" onSubmit={(event) => event.preventDefault()}>
          <label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        </form>
      ) : null}
      <Notice state={state} />
      {data?.period ? <p className="admin-note">{data.period.label}. {data.period.from.slice(0, 10)} to {data.period.to.slice(0, 10)}. {data.period.note}</p> : null}
      {data && section === 'overview' ? <Overview data={data} /> : null}
      {data && section === 'movies' ? <MovieTable rows={data.movies || []} /> : null}
      {data && section === 'search' ? <SearchPanel search={data.search} /> : null}
      {data && section === 'providers' ? <ProviderTable rows={data.providers || []} /> : null}
    </>
  );
}

function Overview({ data }) {
  return (
    <>
      <h2>Overview</h2>
      <ul>
        <li>Movie views {pair(data.overview.movieViews)}</li>
        <li>Searches {pair(data.overview.searches)}</li>
        <li>Download requests {pair(data.overview.downloads)}</li>
        <li>Errors {pair(data.overview.errors)}</li>
      </ul>
      <h2>Catalog</h2>
      <ul>
        <li>Added in this period {data.catalog.added}</li>
        <li>Published in this period {data.catalog.published}</li>
        <li>Archived in this period {data.catalog.archived}</li>
        <li>Metadata failures in this period {data.catalog.metadataFailures}</li>
        <li>Duplicate candidates now {data.catalog.duplicateCandidates}</li>
        <li>Missing posters now {data.catalog.missingPosters}</li>
      </ul>
      <p className="admin-note">{data.catalog.snapshotNote}</p>
      <h2>Downloads</h2>
      <ul>
        <li>Requests {data.downloads.requests}</li>
        <li>Resolved {data.downloads.resolved}</li>
        <li>Failed {data.downloads.failed}</li>
      </ul>
      <h2>Discovery</h2>
      <RailTable rows={data.discovery.rails} />
      <p>Recommendation clicks {data.discovery.recommendations.clicks} after {data.discovery.recommendations.impressions} impressions.</p>
      <p className="admin-note">{data.discovery.recommendations.note}</p>
      <h2>PWA</h2>
      <ul>
        <li>Installs {data.pwa.installs}</li>
        <li>Launches {data.pwa.opens}</li>
        <li>Failures {data.pwa.failures}</li>
      </ul>
      <h2>Performance</h2>
      <Latency label="Search" metric={data.performance.search} />
      <Latency label="Movie detail" metric={data.performance.movieDetail} />
      <Latency label="Download resolution" metric={data.performance.download} />
      <p className="admin-note">Latency samples are kept for {data.performance.sampleRetentionDays} days.</p>
      <h2>Errors</h2>
      {data.errors.length ? (
        <ul>{data.errors.map((item) => <li key={item.status}>{item.status}: {item.count}</li>)}</ul>
      ) : <p className="admin-note">No aggregated errors in this period.</p>}
    </>
  );
}

function pair(value) {
  return `${value.current} (previous ${value.previous})`;
}

function Latency({ label, metric }) {
  if (!metric) return <p>{label}: no samples</p>;
  return <p>{label}: p50 {metric.p50} ms, p75 {metric.p75} ms, p95 {metric.p95} ms, p99 {metric.p99} ms</p>;
}

function MovieTable({ rows }) {
  if (!rows.length) return <p className="admin-note">No movie activity in this period.</p>;
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr><th>Movie</th><th>Views</th><th>Trailers</th><th>Requests</th><th>Resolved</th><th>Failed</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.slug}>
              <td>{row.slug}</td>
              <td>{row.views}</td>
              <td>{row.trailers}</td>
              <td>{row.requests}</td>
              <td>{row.resolved}</td>
              <td>{row.failed}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SearchPanel({ search }) {
  if (!search) return null;
  return (
    <>
      <ul>
        <li>Searches {search.searches}</li>
        <li>With results {search.successful}</li>
        <li>Zero results {search.zeroResults}</li>
        <li>Search-to-click rate {search.clickRate == null ? 'No searches' : search.clickRate}</li>
      </ul>
      <p className="admin-note">Query text is kept for {search.retentionDays} days. Searches do not create catalog entries.</p>
      <h2>Zero-result queries</h2>
      <TermTable rows={search.zeroQueries} />
      <h2>Popular queries</h2>
      <TermTable rows={search.popular} />
    </>
  );
}

function TermTable({ rows }) {
  if (!rows.length) return <p className="admin-note">None in this period.</p>;
  const max = Math.max(...rows.map((row) => row.searches), 1);
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead><tr><th>Query</th><th>Searches</th><th>Zero</th><th>Clicks</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.query}>
              <td>
                {row.query}
                <span style={{ display: 'block', height: 4, background: '#f5b700', width: `${Math.max(4, (row.searches / max) * 100)}%` }} />
              </td>
              <td>{row.searches}</td>
              <td>{row.zeroResults}</td>
              <td>{row.clicks}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RailTable({ rows }) {
  if (!rows.length) return <p className="admin-note">No rail activity in this period.</p>;
  return (
    <ul>
      {rows.map((row) => (
        <li key={row.subject}>{row.subject}: {row.clicks} clicks, {row.impressions} impressions{row.engagementRate == null ? '' : `, engagement ${row.engagementRate}`}</li>
      ))}
    </ul>
  );
}

function ProviderTable({ rows }) {
  if (!rows.length) return <p className="admin-note">No providers.</p>;
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr><th>Provider</th><th>Availability</th><th>Success</th><th>Failure</th><th>Timeout</th><th>Average</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.slug}>
              <td>{row.name}</td>
              <td>{row.availability}</td>
              <td>{row.successRate == null ? 'No attempts' : row.successRate}</td>
              <td>{row.failureRate == null ? 'No attempts' : row.failureRate}</td>
              <td>{row.timeoutRate == null ? 'No attempts' : row.timeoutRate}</td>
              <td>{row.averageResponseMs == null ? 'No samples' : `${row.averageResponseMs} ms`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
