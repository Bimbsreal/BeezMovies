-- Allow administrators to cancel a queued ingestion job.
-- Existing statuses stay in place so running workers do not need a new vocabulary.

ALTER TABLE ingestion_jobs DROP CONSTRAINT ingestion_jobs_status_check;

ALTER TABLE ingestion_jobs ADD CONSTRAINT ingestion_jobs_status_check CHECK (
  status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter', 'cancelled')
);

COMMENT ON CONSTRAINT ingestion_jobs_status_check ON ingestion_jobs IS
  'pending is queued, processing is running, failed with attempts left is retrying.';
