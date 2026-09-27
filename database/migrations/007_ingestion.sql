-- Ingestion jobs, source runtime, provenance, and search-index handoff.
-- PostgreSQL remains the catalog source of truth. These tables track work and origin.

CREATE TABLE catalog_source_runtime (
  catalog_source_id UUID PRIMARY KEY,
  health_status TEXT NOT NULL DEFAULT 'healthy',
  requests_per_minute INTEGER NOT NULL DEFAULT 30,
  min_interval_ms INTEGER NOT NULL DEFAULT 0,
  concurrency_limit INTEGER NOT NULL DEFAULT 2,
  priority INTEGER NOT NULL DEFAULT 0,
  field_priority JSONB NOT NULL DEFAULT '{}'::jsonb,
  allowed_hosts TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  success_count BIGINT NOT NULL DEFAULT 0,
  error_count BIGINT NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  total_latency_ms BIGINT NOT NULL DEFAULT 0,
  in_flight INTEGER NOT NULL DEFAULT 0,
  last_request_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_error_code TEXT,
  disabled_until TIMESTAMPTZ,
  transformation_version TEXT NOT NULL DEFAULT 'catalog-normalize-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT catalog_source_runtime_catalog_source_id_fkey
    FOREIGN KEY (catalog_source_id) REFERENCES catalog_sources (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT catalog_source_runtime_health_check CHECK (
    health_status IN ('healthy', 'degraded', 'disabled')
  ),
  CONSTRAINT catalog_source_runtime_rate_check CHECK (requests_per_minute BETWEEN 1 AND 600),
  CONSTRAINT catalog_source_runtime_interval_check CHECK (min_interval_ms BETWEEN 0 AND 3600000),
  CONSTRAINT catalog_source_runtime_concurrency_check CHECK (concurrency_limit BETWEEN 1 AND 20),
  CONSTRAINT catalog_source_runtime_priority_check CHECK (priority BETWEEN 0 AND 1000),
  CONSTRAINT catalog_source_runtime_field_priority_check CHECK (jsonb_typeof(field_priority) = 'object'),
  CONSTRAINT catalog_source_runtime_configuration_object_check CHECK (jsonb_typeof(configuration) = 'object'),
  CONSTRAINT catalog_source_runtime_configuration_secrets_check CHECK (
    NOT (configuration ?| ARRAY['password', 'secret', 'token', 'api_key', 'apiKey', 'client_secret'])
  ),
  CONSTRAINT catalog_source_runtime_counts_check CHECK (
    success_count >= 0
    AND error_count >= 0
    AND consecutive_failures >= 0
    AND total_latency_ms >= 0
    AND in_flight >= 0
  )
);

COMMENT ON TABLE catalog_source_runtime IS
  'Non-secret source limits, priority, and health. API credentials stay in server environment configuration.';

CREATE TRIGGER catalog_source_runtime_set_updated_at
BEFORE UPDATE ON catalog_source_runtime
FOR EACH ROW
EXECUTE FUNCTION catalog_set_updated_at();

CREATE TABLE ingestion_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
  catalog_source_id UUID NOT NULL,
  external_id TEXT,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error_code TEXT,
  last_error_message TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  fingerprint TEXT,
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ingestion_jobs_catalog_source_id_fkey
    FOREIGN KEY (catalog_source_id) REFERENCES catalog_sources (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ingestion_jobs_type_check CHECK (job_type IN (
    'metadata:discover',
    'metadata:fetch',
    'metadata:normalize',
    'metadata:resolve',
    'metadata:upsert',
    'metadata:index'
  )),
  CONSTRAINT ingestion_jobs_operation_check CHECK (
    operation IN ('discover', 'upsert', 'refresh', 'health', 'index')
  ),
  CONSTRAINT ingestion_jobs_status_check CHECK (
    status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')
  ),
  CONSTRAINT ingestion_jobs_attempts_check CHECK (
    attempt_count >= 0
    AND max_attempts BETWEEN 1 AND 10
    AND attempt_count <= max_attempts
  ),
  CONSTRAINT ingestion_jobs_error_length_check CHECK (
    last_error_message IS NULL OR char_length(last_error_message) <= 500
  ),
  CONSTRAINT ingestion_jobs_payload_check CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT ingestion_jobs_result_check CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  CONSTRAINT ingestion_jobs_external_check CHECK (
    external_id IS NULL OR (btrim(external_id) <> '' AND char_length(external_id) <= 200)
  )
);

CREATE TRIGGER ingestion_jobs_set_updated_at
BEFORE UPDATE ON ingestion_jobs
FOR EACH ROW
EXECUTE FUNCTION catalog_set_updated_at();

CREATE UNIQUE INDEX ingestion_jobs_active_idempotency_key
  ON ingestion_jobs (idempotency_key)
  WHERE status IN ('pending', 'processing', 'failed');

CREATE INDEX ingestion_jobs_due_idx
  ON ingestion_jobs (available_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX ingestion_jobs_source_idx
  ON ingestion_jobs (catalog_source_id, created_at DESC);

CREATE TABLE ingestion_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL,
  catalog_source_id UUID NOT NULL,
  external_id TEXT NOT NULL,
  raw_payload JSONB NOT NULL,
  normalized_payload JSONB NOT NULL,
  source_url TEXT,
  source_updated_at TIMESTAMPTZ,
  transformation_version TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ingestion_records_job_id_fkey
    FOREIGN KEY (job_id) REFERENCES ingestion_jobs (id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT ingestion_records_catalog_source_id_fkey
    FOREIGN KEY (catalog_source_id) REFERENCES catalog_sources (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ingestion_records_payload_check CHECK (
    jsonb_typeof(raw_payload) = 'object' AND jsonb_typeof(normalized_payload) = 'object'
  ),
  CONSTRAINT ingestion_records_url_check CHECK (
    source_url IS NULL OR (source_url ~ '^https://' AND octet_length(source_url) <= 2048)
  )
);

CREATE INDEX ingestion_records_external_idx
  ON ingestion_records (catalog_source_id, external_id, created_at DESC);

CREATE TABLE ingestion_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL,
  candidate_movie_id UUID NOT NULL,
  external_id TEXT NOT NULL,
  confidence TEXT NOT NULL,
  signals JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ingestion_reviews_job_id_fkey
    FOREIGN KEY (job_id) REFERENCES ingestion_jobs (id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT ingestion_reviews_candidate_movie_id_fkey
    FOREIGN KEY (candidate_movie_id) REFERENCES movies (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ingestion_reviews_confidence_check CHECK (confidence IN ('medium')),
  CONSTRAINT ingestion_reviews_status_check CHECK (status IN ('pending', 'accepted', 'rejected')),
  CONSTRAINT ingestion_reviews_signals_check CHECK (jsonb_typeof(signals) = 'object')
);

CREATE INDEX ingestion_reviews_external_idx
  ON ingestion_reviews (external_id, status);

CREATE TABLE catalog_field_provenance (
  movie_id UUID NOT NULL,
  field_name TEXT NOT NULL,
  catalog_source_id UUID NOT NULL,
  source_updated_at TIMESTAMPTZ,
  transformation_version TEXT NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT catalog_field_provenance_pkey PRIMARY KEY (movie_id, field_name),
  CONSTRAINT catalog_field_provenance_movie_id_fkey
    FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT catalog_field_provenance_catalog_source_id_fkey
    FOREIGN KEY (catalog_source_id) REFERENCES catalog_sources (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT catalog_field_provenance_name_check CHECK (field_name ~ '^[a-z0-9_]+$')
);

CREATE TABLE search_index_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL,
  movie_id UUID NOT NULL,
  slug TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ,
  CONSTRAINT search_index_events_movie_id_fkey
    FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT search_index_events_name_check CHECK (event_name IN ('movie.catalog.updated'))
);

COMMENT ON TABLE search_index_events IS
  'Handoff for a later search worker. This table is not a search index.';

CREATE INDEX search_index_events_pending_idx
  ON search_index_events (occurred_at)
  WHERE consumed_at IS NULL;

CREATE TABLE ingestion_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  catalog_source_id UUID,
  schedule_type TEXT NOT NULL,
  interval_seconds INTEGER NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ingestion_schedules_name_key UNIQUE (name),
  CONSTRAINT ingestion_schedules_catalog_source_id_fkey
    FOREIGN KEY (catalog_source_id) REFERENCES catalog_sources (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ingestion_schedules_type_check CHECK (schedule_type IN (
    'initial_import',
    'periodic_update',
    'discovery',
    'stale_refresh',
    'failed_retry',
    'source_health'
  )),
  CONSTRAINT ingestion_schedules_interval_check CHECK (interval_seconds >= 3600)
);

CREATE TRIGGER ingestion_schedules_set_updated_at
BEFORE UPDATE ON ingestion_schedules
FOR EACH ROW
EXECUTE FUNCTION catalog_set_updated_at();
