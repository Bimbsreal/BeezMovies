'use client';

import { Notice, useResource } from './admin-ui';

function Block({ title, rows }) {
  return (
    <section>
      <h2>{title}</h2>
      <dl className="admin-detail">
        {rows.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
    </section>
  );
}

export function CatalogHealthView() {
  const state = useResource('/admin/catalog-health');
  const data = state.data?.data;
  return (
    <>
      <h1>Catalog health</h1>
      <Notice state={state} />
      {data ? (
        <>
          <Block title="Catalog" rows={[
            ['Total', data.catalog.total],
            ['Published', data.catalog.published],
            ['Draft', data.catalog.draft],
            ['Archived', data.catalog.archived],
            ['Pending review', data.catalog.pendingReview],
          ]} />
          <Block title="Metadata" rows={[
            ['Missing synopsis', data.metadata.missingSynopsis],
            ['Missing release', data.metadata.missingRelease],
            ['Missing genre', data.metadata.missingGenre],
            ['Duplicate candidates', data.metadata.duplicateCandidates],
          ]} />
          <Block title="Artwork" rows={[
            ['Missing posters', data.artwork.missingPosters],
            ['Missing backdrops', data.artwork.missingBackdrops],
          ]} />
          <Block title="Media" rows={[
            ['Available', data.media.available],
            ['Unavailable', data.media.unavailable],
            ['Stale', data.media.stale],
          ]} />
          <Block title="Search" rows={[
            ['Indexed', data.search.indexed],
            ['Pending', data.search.pending],
            ['Failed', data.search.failed],
          ]} />
        </>
      ) : null}
    </>
  );
}
