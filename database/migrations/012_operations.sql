-- Operational settings and worker heartbeats. No secrets and no movie binaries.

CREATE TABLE ops_heartbeats (
  service TEXT PRIMARY KEY,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ops_heartbeats_service_check CHECK (service IN ('worker'))
);

INSERT INTO platform_settings (key, value) VALUES
  ('maintenance', '{"enabled":false,"message":"BeezMovies is temporarily unavailable while maintenance finishes."}'::jsonb),
  ('feature_flags', '{"ingestion":true,"searchIndexing":true,"advertising":true}'::jsonb),
  ('backup_status', '{"lastSuccessAt":null,"lastFailureAt":null,"maxAgeHours":26,"sizeBytes":null}'::jsonb)
ON CONFLICT (key) DO NOTHING;
