'use client';

import { MetricGrid, Notice, useResource } from './admin-ui';

export function DashboardView() {
  const state = useResource('/admin/dashboard');
  const data = state.data?.data;
  return (
    <>
      <h1>Dashboard</h1>
      <Notice state={state} />
      {data ? (
        <MetricGrid groups={[
          {
            title: 'Catalog',
            items: [
              { label: 'Total movies', value: data.catalog.totalMovies },
              { label: 'Published', value: data.catalog.published },
              { label: 'Draft', value: data.catalog.draft },
              { label: 'Archived', value: data.catalog.archived },
            ],
          },
          {
            title: 'Media',
            items: [
              { label: 'Available', value: data.media.available },
              { label: 'Unavailable', value: data.media.unavailable },
              { label: 'Failed checks', value: data.media.failedChecks },
            ],
          },
          {
            title: 'Ingestion',
            items: [
              { label: 'Successful', value: data.ingestion.successful },
              { label: 'Failed', value: data.ingestion.failed },
              { label: 'Queued', value: data.ingestion.queued },
            ],
          },
          {
            title: 'Search',
            items: [
              { label: 'Indexed', value: data.search.indexed },
              { label: 'Pending', value: data.search.pending },
              { label: 'Failed', value: data.search.failed },
            ],
          },
          {
            title: 'Users',
            items: [
              { label: 'Total', value: data.users.total },
              { label: 'Active', value: data.users.active },
              { label: 'Suspended', value: data.users.suspended },
            ],
          },
          {
            title: 'System',
            items: [
              { label: 'API', value: data.system.api },
              { label: 'Database', value: data.system.database },
              { label: 'Workers', value: data.system.workers },
              { label: 'Cache', value: data.system.cache },
              { label: 'Queue', value: data.system.queue },
            ],
          },
        ]}
        />
      ) : null}
    </>
  );
}
