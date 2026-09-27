-- Server-controlled monetization. Third-party networks stay disabled until an official integration exists.

CREATE TABLE monetization_providers (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disabled',
  integration_status TEXT NOT NULL,
  placement_types TEXT[] NOT NULL DEFAULT '{}',
  supports_geo BOOLEAN,
  supports_device BOOLEAN,
  priority INTEGER NOT NULL DEFAULT 0,
  credentials_status TEXT NOT NULL DEFAULT 'not_configured',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT monetization_providers_slug_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT monetization_providers_kind_check CHECK (kind IN ('advertising', 'affiliate')),
  CONSTRAINT monetization_providers_status_check CHECK (status IN ('disabled', 'enabled')),
  CONSTRAINT monetization_providers_integration_check CHECK (
    integration_status IN ('documentation_required', 'ready')
  ),
  CONSTRAINT monetization_providers_priority_check CHECK (priority BETWEEN 0 AND 100),
  CONSTRAINT monetization_providers_credentials_check CHECK (
    credentials_status IN ('not_configured', 'configured', 'not_required')
  )
);

CREATE TABLE monetization_placements (
  slug TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  desktop_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  mobile_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  provider_slug TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  frequency_limit INTEGER NOT NULL DEFAULT 1,
  min_interval_seconds INTEGER NOT NULL DEFAULT 3600,
  page_limit INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT monetization_placements_slug_check CHECK (slug IN (
    'VIDEO_PRE_ROLL',
    'IN_FEED_NATIVE',
    'DESKTOP_SIDE_RAIL',
    'MOVIE_DETAIL_RECOMMENDATION',
    'FOOTER_NATIVE'
  )),
  CONSTRAINT monetization_placements_provider_slug_fkey
    FOREIGN KEY (provider_slug) REFERENCES monetization_providers (slug)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT monetization_placements_priority_check CHECK (priority BETWEEN 0 AND 100),
  CONSTRAINT monetization_placements_frequency_check CHECK (frequency_limit BETWEEN 0 AND 5),
  CONSTRAINT monetization_placements_interval_check CHECK (min_interval_seconds BETWEEN 60 AND 86400),
  CONSTRAINT monetization_placements_page_limit_check CHECK (page_limit BETWEEN 0 AND 3)
);

CREATE TABLE monetization_creatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  placement_slug TEXT NOT NULL,
  headline TEXT NOT NULL,
  body TEXT NOT NULL,
  href TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT monetization_creatives_placement_slug_fkey
    FOREIGN KEY (placement_slug) REFERENCES monetization_placements (slug)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT monetization_creatives_headline_check CHECK (char_length(btrim(headline)) BETWEEN 1 AND 80),
  CONSTRAINT monetization_creatives_body_check CHECK (char_length(btrim(body)) BETWEEN 1 AND 180),
  CONSTRAINT monetization_creatives_href_check CHECK (
    href IS NULL OR (href ~ '^https://' AND char_length(href) <= 300 AND position('//' in substr(href, 9)) = 0)
  )
);

CREATE TABLE monetization_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  provider_slug TEXT NOT NULL,
  placement_slug TEXT,
  campaign TEXT,
  session_id UUID,
  conversion_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT monetization_events_type_check CHECK (
    event_type IN ('impression', 'click', 'completion', 'failure', 'affiliate')
  ),
  CONSTRAINT monetization_events_provider_slug_fkey
    FOREIGN KEY (provider_slug) REFERENCES monetization_providers (slug)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT monetization_events_campaign_check CHECK (
    campaign IS NULL OR campaign ~ '^[A-Za-z0-9_-]{1,40}$'
  ),
  CONSTRAINT monetization_events_reference_check CHECK (
    conversion_reference IS NULL OR conversion_reference ~ '^[A-Za-z0-9_-]{1,80}$'
  )
);

CREATE INDEX monetization_events_session_idx
  ON monetization_events (session_id, placement_slug, event_type, created_at DESC);

CREATE TABLE monetization_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,
  consent_required BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT monetization_settings_singleton CHECK (id)
);

INSERT INTO monetization_providers (
  slug, name, kind, integration_status, placement_types, supports_geo, supports_device, credentials_status, priority
) VALUES
  ('house', 'BeezMovies house', 'advertising', 'ready', ARRAY[
    'VIDEO_PRE_ROLL', 'IN_FEED_NATIVE', 'DESKTOP_SIDE_RAIL', 'MOVIE_DETAIL_RECOMMENDATION', 'FOOTER_NATIVE'
  ], FALSE, TRUE, 'not_required', 10),
  ('exoclick', 'ExoClick', 'advertising', 'documentation_required', ARRAY['VIDEO_PRE_ROLL'], NULL, NULL, 'not_configured', 0),
  ('hilltopads', 'HilltopAds', 'advertising', 'documentation_required', ARRAY['VIDEO_PRE_ROLL'], NULL, NULL, 'not_configured', 0),
  ('infolinks', 'Infolinks', 'advertising', 'documentation_required', ARRAY['IN_FEED_NATIVE', 'FOOTER_NATIVE'], NULL, NULL, 'not_configured', 0),
  ('adsterra', 'Adsterra', 'advertising', 'documentation_required', ARRAY['IN_FEED_NATIVE', 'DESKTOP_SIDE_RAIL'], NULL, NULL, 'not_configured', 0),
  ('propellerads', 'PropellerAds', 'advertising', 'documentation_required', ARRAY['IN_FEED_NATIVE'], NULL, NULL, 'not_configured', 0),
  ('rapidgator', 'Rapidgator', 'affiliate', 'documentation_required', ARRAY[]::text[], NULL, NULL, 'not_configured', 0),
  ('katfile', 'Katfile', 'affiliate', 'documentation_required', ARRAY[]::text[], NULL, NULL, 'not_configured', 0),
  ('doodstream', 'DoodStream', 'affiliate', 'documentation_required', ARRAY[]::text[], NULL, NULL, 'not_configured', 0);

INSERT INTO monetization_placements (slug, provider_slug, desktop_enabled, mobile_enabled) VALUES
  ('VIDEO_PRE_ROLL', 'house', TRUE, FALSE),
  ('IN_FEED_NATIVE', 'house', TRUE, FALSE),
  ('DESKTOP_SIDE_RAIL', 'house', TRUE, FALSE),
  ('MOVIE_DETAIL_RECOMMENDATION', 'house', TRUE, FALSE),
  ('FOOTER_NATIVE', 'house', TRUE, FALSE);

INSERT INTO monetization_settings (id, consent_required) VALUES (TRUE, FALSE);

COMMENT ON TABLE monetization_events IS
  'Anonymous placement events. Do not store passwords, account secrets, or client-supplied revenue.';
