-- Resumable catalog synchronization. No catalog rows are inserted.
-- Schedules stay disabled until an administrator enables them.

ALTER TABLE movie_videos
  ADD COLUMN available BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN movie_videos.available IS
  'False when the approved source no longer lists this trailer. The row is kept and not replaced.';

CREATE TABLE catalog_sync_checkpoints (
  catalog_source_id UUID PRIMARY KEY,
  cursor_position INTEGER NOT NULL DEFAULT 0,
  page_number INTEGER NOT NULL DEFAULT 0,
  last_synchronized_at TIMESTAMPTZ,
  last_success_external_id TEXT,
  failure_position INTEGER,
  initial_completed BOOLEAN NOT NULL DEFAULT FALSE,
  seen_external_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT catalog_sync_checkpoints_source_fkey
    FOREIGN KEY (catalog_source_id) REFERENCES catalog_sources (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT catalog_sync_checkpoints_cursor_check CHECK (cursor_position >= 0 AND page_number >= 0),
  CONSTRAINT catalog_sync_checkpoints_failure_check CHECK (failure_position IS NULL OR failure_position >= 0)
);

CREATE TABLE catalog_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_source_id UUID NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  discovered INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  unchanged_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  CONSTRAINT catalog_sync_runs_source_fkey
    FOREIGN KEY (catalog_source_id) REFERENCES catalog_sources (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT catalog_sync_runs_mode_check CHECK (mode IN ('initial', 'incremental', 'scheduled', 'manual')),
  CONSTRAINT catalog_sync_runs_status_check CHECK (status IN ('running', 'paused', 'cancelled', 'completed', 'throttled')),
  CONSTRAINT catalog_sync_runs_counts_check CHECK (
    discovered >= 0 AND created_count >= 0 AND updated_count >= 0 AND unchanged_count >= 0
    AND duplicate_count >= 0 AND rejected_count >= 0 AND review_count >= 0 AND failed_count >= 0
  )
);

CREATE INDEX catalog_sync_runs_source_idx
  ON catalog_sync_runs (catalog_source_id, started_at DESC);

CREATE TABLE catalog_sync_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL,
  task_kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  external_id TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT catalog_sync_tasks_run_fkey
    FOREIGN KEY (run_id) REFERENCES catalog_sync_runs (id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT catalog_sync_tasks_kind_check CHECK (task_kind IN (
    'catalog-sync',
    'metadata-update',
    'country-sync',
    'genre-sync',
    'artwork-sync',
    'series-sync',
    'episode-sync',
    'search-index',
    'cache-invalidation'
  )),
  CONSTRAINT catalog_sync_tasks_status_check CHECK (status IN ('pending', 'completed', 'failed', 'skipped')),
  CONSTRAINT catalog_sync_tasks_detail_check CHECK (jsonb_typeof(detail) = 'object')
);

CREATE INDEX catalog_sync_tasks_run_idx ON catalog_sync_tasks (run_id, task_kind);

ALTER TABLE ingestion_schedules DROP CONSTRAINT ingestion_schedules_type_check;
ALTER TABLE ingestion_schedules ADD CONSTRAINT ingestion_schedules_type_check CHECK (schedule_type IN (
  'initial_import',
  'periodic_update',
  'discovery',
  'stale_refresh',
  'failed_retry',
  'source_health',
  'incremental_sync',
  'episode_sync'
));

INSERT INTO ingestion_schedules (name, catalog_source_id, schedule_type, interval_seconds, enabled)
SELECT 'development-metadata-incremental', id, 'incremental_sync', 86400, FALSE
FROM catalog_sources
WHERE slug = 'development-metadata'
ON CONFLICT (name) DO NOTHING;

INSERT INTO ingestion_schedules (name, catalog_source_id, schedule_type, interval_seconds, enabled)
SELECT 'development-metadata-episodes', id, 'episode_sync', 86400, FALSE
FROM catalog_sources
WHERE slug = 'development-metadata'
ON CONFLICT (name) DO NOTHING;
