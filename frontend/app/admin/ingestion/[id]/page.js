'use client';

import { useParams } from 'next/navigation';
import { IngestionJobView } from '../../../../components/admin/ingestion-view';

export default function AdminIngestionJobPage() {
  const params = useParams();
  return <IngestionJobView id={params.id} />;
}
