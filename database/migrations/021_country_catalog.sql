-- Country is a controlled catalog dimension. Movie links stay in movie_countries.

ALTER TABLE countries
  ADD COLUMN slug TEXT,
  ADD COLUMN display_name TEXT,
  ADD COLUMN rail_title TEXT,
  ADD COLUMN region TEXT,
  ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN priority BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE countries
SET slug = CASE code
      WHEN 'US' THEN 'usa'
      WHEN 'DE' THEN 'germany'
      WHEN 'FR' THEN 'france'
      ELSE lower(code)
    END,
    display_name = name,
    rail_title = CASE code
      WHEN 'US' THEN 'American Movies'
      WHEN 'DE' THEN 'German Movies'
      WHEN 'FR' THEN 'French Movies'
      ELSE name || ' Movies'
    END,
    region = CASE code
      WHEN 'US' THEN 'North America'
      WHEN 'DE' THEN 'Europe'
      WHEN 'FR' THEN 'Europe'
      ELSE 'Europe'
    END,
    priority = (code = 'US')
WHERE slug IS NULL;

ALTER TABLE countries
  ALTER COLUMN slug SET NOT NULL,
  ALTER COLUMN display_name SET NOT NULL,
  ALTER COLUMN rail_title SET NOT NULL,
  ALTER COLUMN region SET NOT NULL;

ALTER TABLE countries
  ADD CONSTRAINT countries_slug_key UNIQUE (slug),
  ADD CONSTRAINT countries_slug_format_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  ADD CONSTRAINT countries_display_name_check CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 80),
  ADD CONSTRAINT countries_rail_title_check CHECK (char_length(btrim(rail_title)) BETWEEN 1 AND 80),
  ADD CONSTRAINT countries_region_check CHECK (
    region IN ('Africa', 'Europe', 'North America', 'South America', 'Asia', 'Oceania', 'Middle East')
  );

CREATE INDEX idx_countries_active_name ON countries (active, display_name);

CREATE TABLE country_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id UUID NOT NULL,
  alias TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT country_aliases_country_id_fkey
    FOREIGN KEY (country_id) REFERENCES countries (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT country_aliases_alias_key UNIQUE (alias),
  CONSTRAINT country_aliases_alias_check CHECK (alias ~ '^[a-z0-9]+(?:[ -][a-z0-9]+)*$')
);

CREATE INDEX idx_country_aliases_country_id ON country_aliases (country_id);

CREATE TABLE country_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_code TEXT NOT NULL,
  movie_id UUID,
  source_slug TEXT,
  reason TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT country_reviews_movie_id_fkey
    FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT country_reviews_raw_code_check CHECK (char_length(btrim(raw_code)) BETWEEN 1 AND 32),
  CONSTRAINT country_reviews_reason_check CHECK (reason IN ('unknown', 'invalid', 'conflict')),
  CONSTRAINT country_reviews_status_check CHECK (status IN ('pending', 'accepted', 'rejected'))
);

CREATE UNIQUE INDEX country_reviews_open_key
  ON country_reviews (raw_code, reason, COALESCE(movie_id, '00000000-0000-4000-8000-000000000000'::uuid))
  WHERE status = 'pending';

INSERT INTO countries (id, code, name, slug, display_name, rail_title, region, active, priority) VALUES
  ('22222222-2222-4222-8222-222222222211', 'NG', 'Nigeria', 'nigeria', 'Nigeria', 'Nigerian Movies', 'Africa', TRUE, TRUE),
  ('22222222-2222-4222-8222-222222222212', 'GH', 'Ghana', 'ghana', 'Ghana', 'Ghanaian Movies', 'Africa', TRUE, TRUE),
  ('22222222-2222-4222-8222-222222222213', 'ZA', 'South Africa', 'south-africa', 'South Africa', 'South African Movies', 'Africa', TRUE, TRUE),
  ('22222222-2222-4222-8222-222222222214', 'GB', 'United Kingdom', 'uk', 'United Kingdom', 'British Movies', 'Europe', TRUE, TRUE),
  ('22222222-2222-4222-8222-222222222215', 'RU', 'Russia', 'russia', 'Russia', 'Russian Movies', 'Europe', TRUE, TRUE),
  ('22222222-2222-4222-8222-222222222216', 'CN', 'China', 'china', 'China', 'Chinese Movies', 'Asia', TRUE, TRUE),
  ('22222222-2222-4222-8222-222222222217', 'TR', 'Türkiye', 'turkiye', 'Türkiye', 'Turkish Movies', 'Middle East', TRUE, TRUE)
ON CONFLICT (code) DO UPDATE SET
  slug = EXCLUDED.slug,
  display_name = EXCLUDED.display_name,
  rail_title = EXCLUDED.rail_title,
  region = EXCLUDED.region,
  priority = EXCLUDED.priority;

UPDATE countries
SET display_name = 'United States',
    rail_title = 'American Movies',
    region = 'North America',
    slug = 'usa',
    priority = TRUE
WHERE code = 'US';

UPDATE countries
SET display_name = 'Germany',
    rail_title = 'German Movies',
    region = 'Europe',
    slug = 'germany'
WHERE code = 'DE';

UPDATE countries
SET display_name = 'France',
    rail_title = 'French Movies',
    region = 'Europe',
    slug = 'france'
WHERE code = 'FR';

INSERT INTO country_aliases (country_id, alias)
SELECT id, alias
FROM countries
JOIN (VALUES
  ('NG', 'nigeria'),
  ('NG', 'nigerian'),
  ('GH', 'ghana'),
  ('GH', 'ghanaian'),
  ('ZA', 'south africa'),
  ('ZA', 'south-africa'),
  ('ZA', 'south african'),
  ('GB', 'uk'),
  ('GB', 'united kingdom'),
  ('GB', 'united-kingdom'),
  ('GB', 'britain'),
  ('GB', 'british'),
  ('US', 'usa'),
  ('US', 'united states'),
  ('US', 'united-states'),
  ('US', 'america'),
  ('US', 'american'),
  ('RU', 'russia'),
  ('RU', 'russian'),
  ('CN', 'china'),
  ('CN', 'chinese'),
  ('TR', 'turkiye'),
  ('TR', 'turkey'),
  ('TR', 'turkish'),
  ('DE', 'germany'),
  ('DE', 'german'),
  ('FR', 'france'),
  ('FR', 'french')
) AS incoming(code, alias) ON incoming.code = countries.code
ON CONFLICT (alias) DO NOTHING;

ALTER TABLE homepage_rails DROP CONSTRAINT homepage_rails_source_type_check;
ALTER TABLE homepage_rails ADD CONSTRAINT homepage_rails_source_type_check CHECK (
  source_type IN ('featured', 'recent', 'trending', 'genres', 'collections', 'collection', 'countries')
);

INSERT INTO homepage_rails (
  id, slug, title, source_type, source_slug, sort_order, item_limit, enabled, cache_seconds
) VALUES (
  '15151515-1515-4515-8515-151515151507',
  'countries',
  'Countries',
  'countries',
  NULL,
  45,
  12,
  TRUE,
  300
) ON CONFLICT (slug) DO NOTHING;
