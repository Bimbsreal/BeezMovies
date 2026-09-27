-- Catalog relationships. Deletes are restricted so archiving stays explicit.

CREATE TABLE alternate_titles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID NOT NULL,
  title TEXT NOT NULL,
  normalized_title TEXT GENERATED ALWAYS AS (catalog_normalize_text(title)) STORED NOT NULL,
  language_id UUID,
  country_id UUID,
  catalog_source_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT alternate_titles_title_check CHECK (btrim(title) <> ''),
  CONSTRAINT alternate_titles_identity_key
    UNIQUE NULLS NOT DISTINCT (movie_id, normalized_title, language_id, country_id),
  CONSTRAINT alternate_titles_movie_id_fkey
    FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT alternate_titles_language_id_fkey
    FOREIGN KEY (language_id) REFERENCES languages (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT alternate_titles_country_id_fkey
    FOREIGN KEY (country_id) REFERENCES countries (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT alternate_titles_catalog_source_id_fkey
    FOREIGN KEY (catalog_source_id) REFERENCES catalog_sources (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE movie_genres (
  movie_id UUID NOT NULL,
  genre_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT movie_genres_pkey PRIMARY KEY (movie_id, genre_id),
  CONSTRAINT movie_genres_movie_id_fkey
    FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT movie_genres_genre_id_fkey
    FOREIGN KEY (genre_id) REFERENCES genres (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE movie_languages (
  movie_id UUID NOT NULL,
  language_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT movie_languages_pkey PRIMARY KEY (movie_id, language_id),
  CONSTRAINT movie_languages_movie_id_fkey
    FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT movie_languages_language_id_fkey
    FOREIGN KEY (language_id) REFERENCES languages (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE movie_countries (
  movie_id UUID NOT NULL,
  country_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT movie_countries_pkey PRIMARY KEY (movie_id, country_id),
  CONSTRAINT movie_countries_movie_id_fkey
    FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT movie_countries_country_id_fkey
    FOREIGN KEY (country_id) REFERENCES countries (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE movie_tags (
  movie_id UUID NOT NULL,
  tag_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT movie_tags_pkey PRIMARY KEY (movie_id, tag_id),
  CONSTRAINT movie_tags_movie_id_fkey
    FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT movie_tags_tag_id_fkey
    FOREIGN KEY (tag_id) REFERENCES tags (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE movie_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID NOT NULL,
  person_id UUID NOT NULL,
  department TEXT NOT NULL,
  job TEXT NOT NULL,
  character_name TEXT,
  billing_order INTEGER,
  catalog_source_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT movie_credits_department_check CHECK (btrim(department) <> ''),
  CONSTRAINT movie_credits_job_check CHECK (btrim(job) <> ''),
  CONSTRAINT movie_credits_billing_order_check CHECK (
    billing_order IS NULL OR billing_order >= 0
  ),
  CONSTRAINT movie_credits_identity_key
    UNIQUE NULLS NOT DISTINCT (movie_id, person_id, department, job, character_name),
  CONSTRAINT movie_credits_movie_id_fkey
    FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT movie_credits_person_id_fkey
    FOREIGN KEY (person_id) REFERENCES people (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT movie_credits_catalog_source_id_fkey
    FOREIGN KEY (catalog_source_id) REFERENCES catalog_sources (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE collection_movies (
  collection_id UUID NOT NULL,
  movie_id UUID NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT collection_movies_pkey PRIMARY KEY (collection_id, movie_id),
  CONSTRAINT collection_movies_movie_id_key UNIQUE (movie_id),
  CONSTRAINT collection_movies_sort_order_check CHECK (sort_order >= 0),
  CONSTRAINT collection_movies_collection_id_fkey
    FOREIGN KEY (collection_id) REFERENCES collections (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT collection_movies_movie_id_fkey
    FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE external_identifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID NOT NULL,
  catalog_source_id UUID NOT NULL,
  external_id TEXT NOT NULL,
  last_synchronized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT external_identifiers_external_id_check CHECK (btrim(external_id) <> ''),
  CONSTRAINT external_identifiers_source_external_key UNIQUE (catalog_source_id, external_id),
  CONSTRAINT external_identifiers_movie_source_key UNIQUE (movie_id, catalog_source_id),
  CONSTRAINT external_identifiers_movie_id_fkey
    FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT external_identifiers_catalog_source_id_fkey
    FOREIGN KEY (catalog_source_id) REFERENCES catalog_sources (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE movie_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID NOT NULL,
  catalog_source_id UUID,
  label TEXT NOT NULL,
  value NUMERIC(8, 3) NOT NULL,
  scale NUMERIC(8, 3) NOT NULL,
  vote_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT movie_ratings_label_check CHECK (btrim(label) <> ''),
  CONSTRAINT movie_ratings_scale_check CHECK (scale > 0),
  CONSTRAINT movie_ratings_value_check CHECK (value >= 0 AND value <= scale),
  CONSTRAINT movie_ratings_vote_count_check CHECK (vote_count IS NULL OR vote_count >= 0),
  CONSTRAINT movie_ratings_identity_key
    UNIQUE NULLS NOT DISTINCT (movie_id, catalog_source_id, label),
  CONSTRAINT movie_ratings_movie_id_fkey
    FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT movie_ratings_catalog_source_id_fkey
    FOREIGN KEY (catalog_source_id) REFERENCES catalog_sources (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TRIGGER movie_ratings_set_updated_at
BEFORE UPDATE ON movie_ratings
FOR EACH ROW
EXECUTE FUNCTION catalog_set_updated_at();
