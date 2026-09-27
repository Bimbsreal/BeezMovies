-- Privacy-conscious product analytics. No passwords, addresses, or user profiles.
-- Raw rows are short-lived. Dashboards read the daily rollup.

CREATE TABLE analytics_events (
  id UUID PRIMARY KEY,
  event_name TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  subject_key TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  provider_slug TEXT NOT NULL DEFAULT '',
  failure_category TEXT NOT NULL DEFAULT '',
  status_code SMALLINT NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  visitor_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analytics_events_name_check CHECK (
    event_name IN (
      'PAGE_VIEW', 'MOVIE_VIEW', 'SEARCH', 'SEARCH_RESULT_CLICK', 'TRAILER_PLAY',
      'DOWNLOAD_REQUEST', 'DOWNLOAD_RESOLVED', 'DOWNLOAD_FAILED',
      'WATCHLIST_ADD', 'FAVORITE_ADD', 'PWA_INSTALL', 'PWA_OPEN', 'PWA_FAILURE',
      'RAIL_IMPRESSION', 'RAIL_CLICK', 'RECOMMENDATION_IMPRESSION', 'RECOMMENDATION_CLICK',
      'WEB_VITAL', 'API_LATENCY', 'ERROR',
      'CATALOG_ADDED', 'CATALOG_PUBLISHED', 'CATALOG_ARCHIVED'
    )
  ),
  CONSTRAINT analytics_events_subject_check CHECK (char_length(subject_key) <= 80),
  CONSTRAINT analytics_events_outcome_check CHECK (char_length(outcome) <= 32),
  CONSTRAINT analytics_events_provider_check CHECK (char_length(provider_slug) <= 80),
  CONSTRAINT analytics_events_failure_check CHECK (char_length(failure_category) <= 64),
  CONSTRAINT analytics_events_status_check CHECK (status_code >= 0),
  CONSTRAINT analytics_events_duration_check CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CONSTRAINT analytics_events_visitor_check CHECK (
    visitor_key IS NULL OR visitor_key ~ '^[A-Za-z0-9_-]{8,64}$'
  )
);

CREATE INDEX analytics_events_created_idx ON analytics_events (created_at);

CREATE TABLE analytics_daily (
  day DATE NOT NULL,
  event_name TEXT NOT NULL,
  subject_key TEXT NOT NULL DEFAULT '',
  outcome TEXT NOT NULL DEFAULT '',
  provider_slug TEXT NOT NULL DEFAULT '',
  failure_category TEXT NOT NULL DEFAULT '',
  status_code SMALLINT NOT NULL DEFAULT 0,
  event_count INTEGER NOT NULL DEFAULT 0,
  duration_sum BIGINT NOT NULL DEFAULT 0,
  duration_count INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT analytics_daily_pkey PRIMARY KEY (
    day, event_name, subject_key, outcome, provider_slug, failure_category, status_code
  ),
  CONSTRAINT analytics_daily_count_check CHECK (
    event_count >= 0 AND duration_sum >= 0 AND duration_count >= 0
  )
);

CREATE INDEX analytics_daily_day_idx ON analytics_daily (day, event_name);

CREATE TABLE analytics_search_terms (
  day DATE NOT NULL,
  query_text TEXT NOT NULL,
  search_count INTEGER NOT NULL DEFAULT 0,
  zero_count INTEGER NOT NULL DEFAULT 0,
  click_count INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT analytics_search_terms_pkey PRIMARY KEY (day, query_text),
  CONSTRAINT analytics_search_terms_text_check CHECK (char_length(query_text) BETWEEN 1 AND 80),
  CONSTRAINT analytics_search_terms_count_check CHECK (
    search_count >= 0 AND zero_count >= 0 AND click_count >= 0
  )
);

CREATE TABLE analytics_latency_samples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analytics_latency_metric_check CHECK (char_length(metric) BETWEEN 3 AND 80),
  CONSTRAINT analytics_latency_duration_check CHECK (duration_ms >= 0)
);

CREATE INDEX analytics_latency_metric_idx
  ON analytics_latency_samples (metric, recorded_at);

COMMENT ON TABLE analytics_events IS
  'Short-lived product events. No user id, email, address, or precise location.';

COMMENT ON TABLE analytics_daily IS
  'Aggregated product counts. Dashboards read this table, not the raw event log.';

COMMENT ON TABLE analytics_search_terms IS
  'Search text kept only long enough to find zero-result gaps. No user identity.';
