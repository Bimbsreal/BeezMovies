'use client';

import { useResource } from './admin-ui';

const CATEGORIES = [
  'Country Conflict',
  'Content-Type Conflict',
  'Duplicate',
  'Missing Metadata',
  'Series Integrity',
  'Artwork',
  'Media',
  'Search',
  'Other',
];

export function ReconciliationReport() {
  const state = useResource('/admin/editorial');
  const report = state.data?.data?.reconciliation;
  if (state.status === 'loading') return <p>Loading reconciliation.</p>;
  if (!report) return null;
  const summary = report.summary;
  return (
    <section>
      <h2>Reconciliation</h2>
      <p role="status">{report.recovery.reason} Updated {report.recovery.updated}.</p>
      <p className="admin-note">
        Checked {summary.checked}
        {' · '}Matches {summary.matches}
        {' · '}Missing {summary.missing}
        {' · '}Duplicates {summary.duplicates}
        {' · '}Conflicts {summary.conflicts}
        {' · '}Review {summary.reviewRequired}
        {' · '}Invalid {summary.invalid}
        {' · '}Search {summary.searchMismatches}
        {' · '}Media {summary.mediaMismatches}
      </p>
      <p className="admin-note">
        Movies {report.totals.movies}
        {' · '}Series {report.totals.series}
        {' · '}Seasons {report.totals.seasons}
        {' · '}Episodes {report.totals.episodes}
        {' · '}Countries {report.totals.countries}
        {' · '}Genres {report.totals.genres}
        {' · '}Languages {report.totals.languages}
        {' · '}Collections {report.totals.collections}
      </p>
      {CATEGORIES.map((category) => {
        const rows = report.review.computed.filter((item) => item.category === category);
        return (
          <section key={category}>
            <h3>{category}</h3>
            {rows.length === 0 ? <p className="admin-note">None waiting.</p> : (
              <ul>
                {rows.map((row) => (
                  <li key={`${row.category}-${row.subject}-${row.detail}`}>{row.subject} · {row.code} · {row.detail}</li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </section>
  );
}
