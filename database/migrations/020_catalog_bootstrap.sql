-- Catalog bootstrap checkpoints. Dry runs do not publish movies.

CREATE TABLE catalog_seed_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_slug TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'dry_run',
  status TEXT NOT NULL DEFAULT 'running',
  cursor_offset INTEGER NOT NULL DEFAULT 0,
  discovered INTEGER NOT NULL DEFAULT 0,
  processed INTEGER NOT NULL DEFAULT 0,
  valid_count INTEGER NOT NULL DEFAULT 0,
  invalid_count INTEGER NOT NULL DEFAULT 0,
  incomplete_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  approved_count INTEGER NOT NULL DEFAULT 0,
  published_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  batch_size INTEGER NOT NULL,
  last_error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  opened_by UUID,
  CONSTRAINT catalog_seed_runs_mode_check CHECK (mode = 'dry_run'),
  CONSTRAINT catalog_seed_runs_status_check CHECK (
    status IN ('running', 'paused', 'completed', 'cancelled', 'failed')
  ),
  CONSTRAINT catalog_seed_runs_counts_check CHECK (
    cursor_offset >= 0 AND discovered >= 0 AND processed >= 0
    AND valid_count >= 0 AND invalid_count >= 0 AND incomplete_count >= 0
    AND duplicate_count >= 0 AND review_count >= 0 AND approved_count >= 0
    AND published_count >= 0 AND failed_count >= 0
    AND batch_size BETWEEN 1 AND 25
  ),
  CONSTRAINT catalog_seed_runs_opened_by_fkey
    FOREIGN KEY (opened_by) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE catalog_seed_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL,
  batch_index INTEGER NOT NULL,
  cursor_before INTEGER NOT NULL,
  cursor_after INTEGER NOT NULL,
  started INTEGER NOT NULL,
  processed INTEGER NOT NULL,
  accepted INTEGER NOT NULL,
  rejected INTEGER NOT NULL,
  duplicates INTEGER NOT NULL,
  errors INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT catalog_seed_batches_run_id_fkey
    FOREIGN KEY (run_id) REFERENCES catalog_seed_runs (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT catalog_seed_batches_index_unique UNIQUE (run_id, batch_index)
);

COMMENT ON TABLE catalog_seed_runs IS
  'Restartable dry-run checkpoints for an approved metadata source. Publishing stays a separate confirmed step.';
