import { ReconciliationReport } from '../../../components/admin/catalog-reconciliation';
import { ReviewView } from '../../../components/admin/review-view';

export default function ReviewsPage() {
  return (
    <>
      <ReviewView />
      <ReconciliationReport />
    </>
  );
}
