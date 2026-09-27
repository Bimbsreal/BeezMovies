-- Foundation marker used by the readiness check.
-- Feature schemas are added in later migrations.

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_meta (key, value)
VALUES ('foundation', 'ready')
ON CONFLICT (key) DO NOTHING;
