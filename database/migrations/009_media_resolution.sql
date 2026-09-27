-- Download events and provider health. No binaries and no credentials.

ALTER TABLE media_references
  ADD CONSTRAINT media_references_quality_check CHECK (
    quality IS NULL OR quality IN ('480p', '720p', '1080p', '2160p')
  );

CREATE TABLE provider_health (
  provider_id UUID PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_checked_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error_code TEXT,
  CONSTRAINT provider_health_status_check CHECK (
    status IN ('available', 'degraded', 'unavailable', 'unknown')
  ),
  CONSTRAINT provider_health_error_check CHECK (
    last_error_code IS NULL OR char_length(last_error_code) <= 64
  ),
  CONSTRAINT provider_health_provider_id_fkey
    FOREIGN KEY (provider_id) REFERENCES providers (id)
    ON DELETE CASCADE ON UPDATE RESTRICT
);

COMMENT ON TABLE provider_health IS
  'Operational provider status. Do not store credentials or signed URLs.';

CREATE TABLE download_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID NOT NULL,
  media_reference_id UUID,
  provider_id UUID,
  result TEXT NOT NULL,
  failure_category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT download_events_result_check CHECK (result IN ('success', 'failed')),
  CONSTRAINT download_events_failure_check CHECK (
    failure_category IS NULL OR char_length(failure_category) <= 64
  ),
  CONSTRAINT download_events_movie_id_fkey
    FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT download_events_media_reference_id_fkey
    FOREIGN KEY (media_reference_id) REFERENCES media_references (id)
    ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT download_events_provider_id_fkey
    FOREIGN KEY (provider_id) REFERENCES providers (id)
    ON DELETE SET NULL ON UPDATE RESTRICT
);

COMMENT ON TABLE download_events IS
  'Download outcomes only. No user, session, address, or signed URL is stored.';

CREATE INDEX download_events_created_at_idx ON download_events (created_at DESC);

INSERT INTO providers (id, name, slug, provider_type, status, capabilities, configuration) VALUES (
  '88888888-8888-4888-8888-888888888802',
  'Development media',
  'development-media',
  'media',
  'active',
  '{"media_types":["download"],"qualities":["480p","720p","1080p","2160p"],"priority":10,"local":true}'::jsonb,
  '{}'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

-- The Nosferatu development download reference lives in database/seeds.
-- A migration must not depend on seed movie rows, or a clean database fails.
