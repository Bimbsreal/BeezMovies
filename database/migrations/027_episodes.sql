-- Episodic structure. No series, season, or episode rows are inserted.
-- The approved development source still has no episodic records.

ALTER TABLE content_types DROP CONSTRAINT content_types_code_check;
ALTER TABLE content_types
  ADD CONSTRAINT content_types_code_check CHECK (code IN ('movie', 'series'));

INSERT INTO content_types (id, code, name, plural_name, route_prefix, active, sort_order)
VALUES (
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
  'series',
  'Series',
  'Series',
  'series',
  TRUE,
  2
);

INSERT INTO industry_labels (country_id, content_type_id, label, origin)
SELECT s.country_id, t.id, s.stem || ' ' || t.plural_name, 'derived'
FROM industry_stems s
JOIN content_types t ON t.code = 'series'
ON CONFLICT (country_id, content_type_id) DO NOTHING;

CREATE TABLE seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id UUID NOT NULL,
  season_number INTEGER NOT NULL,
  title TEXT,
  synopsis TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT seasons_series_id_fkey
    FOREIGN KEY (series_id) REFERENCES movies (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT seasons_number_key UNIQUE (series_id, season_number),
  CONSTRAINT seasons_number_check CHECK (season_number BETWEEN 1 AND 200),
  CONSTRAINT seasons_title_check CHECK (title IS NULL OR char_length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT seasons_synopsis_check CHECK (synopsis IS NULL OR char_length(synopsis) BETWEEN 1 AND 4000),
  CONSTRAINT seasons_status_check CHECK (status IN ('draft', 'review', 'approved', 'active', 'archived'))
);

CREATE INDEX idx_seasons_series_status ON seasons (series_id, status, season_number);

CREATE TABLE episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL,
  episode_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  synopsis TEXT,
  runtime_minutes INTEGER,
  release_date DATE,
  thumbnail_url TEXT,
  external_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT episodes_season_id_fkey
    FOREIGN KEY (season_id) REFERENCES seasons (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT episodes_number_key UNIQUE (season_id, episode_number),
  CONSTRAINT episodes_slug_key UNIQUE (slug),
  CONSTRAINT episodes_number_check CHECK (episode_number BETWEEN 1 AND 500),
  CONSTRAINT episodes_title_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT episodes_slug_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT episodes_synopsis_check CHECK (synopsis IS NULL OR char_length(synopsis) BETWEEN 1 AND 4000),
  CONSTRAINT episodes_runtime_check CHECK (runtime_minutes IS NULL OR runtime_minutes > 0),
  CONSTRAINT episodes_thumbnail_check CHECK (
    thumbnail_url IS NULL OR thumbnail_url ~ '^https://'
  ),
  CONSTRAINT episodes_status_check CHECK (status IN ('draft', 'review', 'approved', 'active', 'archived'))
);

CREATE UNIQUE INDEX episodes_external_id_key
  ON episodes (season_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX idx_episodes_season_status ON episodes (season_id, status, episode_number);

ALTER TABLE media_references
  ADD COLUMN episode_id UUID;

ALTER TABLE media_references
  ADD CONSTRAINT media_references_episode_id_fkey
    FOREIGN KEY (episode_id) REFERENCES episodes (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE INDEX idx_media_references_episode_id
  ON media_references (episode_id)
  WHERE episode_id IS NOT NULL;

CREATE TABLE episode_progress (
  user_id UUID NOT NULL,
  episode_id UUID NOT NULL,
  position_seconds INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT episode_progress_pkey PRIMARY KEY (user_id, episode_id),
  CONSTRAINT episode_progress_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT episode_progress_episode_id_fkey
    FOREIGN KEY (episode_id) REFERENCES episodes (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT episode_progress_position_check CHECK (position_seconds >= 0 AND position_seconds <= 86400)
);

CREATE INDEX idx_episode_progress_user_updated
  ON episode_progress (user_id, updated_at DESC);
