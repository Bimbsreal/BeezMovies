-- Country and content type are separate catalog dimensions.
-- The approved development source identifies films (dev-seed:movie:*).
-- Series, seasons, and episodes are not created here because that source has no episodic records.

CREATE TABLE content_types (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  plural_name TEXT NOT NULL,
  route_prefix TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT content_types_code_key UNIQUE (code),
  CONSTRAINT content_types_code_check CHECK (code IN ('movie')),
  CONSTRAINT content_types_name_check CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  CONSTRAINT content_types_plural_check CHECK (char_length(btrim(plural_name)) BETWEEN 1 AND 40),
  CONSTRAINT content_types_route_check CHECK (route_prefix ~ '^[a-z]+(?:-[a-z]+)*$')
);

INSERT INTO content_types (id, code, name, plural_name, route_prefix, active, sort_order)
VALUES (
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  'movie',
  'Movie',
  'Movies',
  'movies',
  TRUE,
  1
);

ALTER TABLE movies
  ADD COLUMN content_type_id UUID;

ALTER TABLE movies
  ADD CONSTRAINT movies_content_type_id_fkey
    FOREIGN KEY (content_type_id) REFERENCES content_types (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Existing rows are film records in the movies table. New rows stay unclassified until a source type is known.
UPDATE movies
SET content_type_id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
WHERE content_type_id IS NULL;

ALTER TABLE movies
  ADD CONSTRAINT movies_active_classification_check CHECK (
    status <> 'active' OR content_type_id IS NOT NULL
  );

CREATE INDEX idx_movies_content_type_status
  ON movies (content_type_id, status)
  WHERE archived_at IS NULL;

CREATE INDEX idx_movie_genres_genre_movie
  ON movie_genres (genre_id, movie_id);

CREATE INDEX idx_movie_countries_country_movie
  ON movie_countries (country_id, movie_id);

CREATE TABLE industry_stems (
  country_id UUID PRIMARY KEY,
  stem TEXT NOT NULL,
  route_slug TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT industry_stems_country_id_fkey
    FOREIGN KEY (country_id) REFERENCES countries (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT industry_stems_route_slug_key UNIQUE (route_slug),
  CONSTRAINT industry_stems_stem_check CHECK (char_length(btrim(stem)) BETWEEN 1 AND 40),
  CONSTRAINT industry_stems_route_slug_check CHECK (route_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

INSERT INTO industry_stems (country_id, stem, route_slug)
SELECT c.id, v.stem, v.route_slug
FROM (VALUES
  ('NG', 'Nollywood', 'nollywood'),
  ('US', 'Hollywood', 'hollywood'),
  ('GH', 'Ghanaian', 'ghanaian'),
  ('ZA', 'South African', 'south-african'),
  ('CN', 'Chinese', 'chinese'),
  ('TR', 'Turkish', 'turkish'),
  ('GB', 'British', 'british'),
  ('RU', 'Russian', 'russian')
) AS v(code, stem, route_slug)
JOIN countries c ON c.code = v.code;

CREATE TABLE industry_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id UUID NOT NULL,
  content_type_id UUID NOT NULL,
  label TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'derived',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT industry_labels_pair_key UNIQUE (country_id, content_type_id),
  CONSTRAINT industry_labels_country_id_fkey
    FOREIGN KEY (country_id) REFERENCES countries (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT industry_labels_content_type_id_fkey
    FOREIGN KEY (content_type_id) REFERENCES content_types (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT industry_labels_label_check CHECK (char_length(btrim(label)) BETWEEN 1 AND 80),
  CONSTRAINT industry_labels_origin_check CHECK (origin IN ('derived', 'override'))
);

INSERT INTO industry_labels (country_id, content_type_id, label, origin)
SELECT s.country_id, t.id, s.stem || ' ' || t.plural_name, 'derived'
FROM industry_stems s
JOIN content_types t ON t.code = 'movie';

CREATE TABLE classification_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID,
  field TEXT NOT NULL,
  raw_value TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT classification_reviews_movie_id_fkey
    FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT classification_reviews_field_check CHECK (field IN ('country', 'content_type', 'industry_label')),
  CONSTRAINT classification_reviews_reason_check CHECK (reason IN ('missing', 'unknown', 'conflict', 'ambiguous')),
  CONSTRAINT classification_reviews_status_check CHECK (status IN ('pending', 'accepted', 'rejected')),
  CONSTRAINT classification_reviews_raw_check CHECK (raw_value IS NULL OR char_length(raw_value) BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX classification_reviews_open_key
  ON classification_reviews (field, reason, COALESCE(movie_id, '00000000-0000-4000-8000-000000000000'::uuid), COALESCE(raw_value, ''))
  WHERE status = 'pending';

ALTER TABLE search_documents
  ADD COLUMN content_type_code TEXT NOT NULL DEFAULT 'movie';

ALTER TABLE search_documents
  ADD CONSTRAINT search_documents_content_type_check CHECK (content_type_code ~ '^[a-z_]+$');

CREATE INDEX idx_search_documents_content_type
  ON search_documents (content_type_code);
