'use client';

import { useResource } from './admin-ui';

export function CatalogCensus() {
  const state = useResource('/admin/ingestion/sync');
  const catalog = state.data?.data?.catalog;
  if (state.status === 'loading') return <p>Loading catalog census.</p>;
  if (!catalog) return null;
  const visible = catalog.countries.filter((country) => country.focus || country.published > 0);
  const typeNames = catalog.countries[0]?.types || [];
  return (
    <>
      {catalog.seeding?.applyAllowed === false ? (
        <p role="alert">
          Production seeding is blocked. {catalog.seeding.reasons.join(' ')} Backup status: {catalog.seeding.backup}.
        </p>
      ) : null}
      <h2>Catalog census</h2>
      <p className="admin-note">
        Movies {catalog.totals.movies}
        {' · '}Series {catalog.totals.series}
        {' · '}Seasons {catalog.totals.seasons}
        {' · '}Episodes {catalog.totals.episodes}
        {' · '}Duplicates {catalog.duplicates}
        {' · '}Review {catalog.reviewRequired}
        {' · '}Rejected {catalog.gaps.missingContentType + catalog.gaps.missingCountry + catalog.gaps.contentTypeConflicts}
      </p>
      <table>
        <thead>
          <tr>
            <th>Country</th>
            {typeNames.map((type) => <th key={type.code}>{type.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {visible.map((country) => (
            <tr key={country.code}>
              <td>{country.country}</td>
              {country.types.map((type) => <td key={type.code}>{type.published}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="admin-note">{catalog.sourceNote}</p>
    </>
  );
}
