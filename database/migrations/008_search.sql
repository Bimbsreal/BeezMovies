-- Derived search index. PostgreSQL remains the catalog source of truth.
-- pg_trgm is a trusted extension on PostgreSQL 13+ and can be created by the database owner.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE search_index_events DROP CONSTRAINT search_index_events_name_check;
ALTER TABLE search_index_events
  ADD CONSTRAINT search_index_events_name_check CHECK (
    event_name IN ('movie.catalog.updated', 'movie.catalog.archived', 'movie.catalog.deleted')
  );

ALTER TABLE search_index_events
  ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN last_error_code TEXT;

ALTER TABLE search_index_events
  ADD CONSTRAINT search_index_events_attempt_check CHECK (attempt_count >= 0 AND attempt_count <= 5);

CREATE SEQUENCE search_index_version_seq AS INTEGER;

CREATE TABLE search_index_versions (
  version INTEGER PRIMARY KEY DEFAULT nextval('search_index_version_seq'),
  status TEXT NOT NULL,
  document_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  error_code TEXT,
  CONSTRAINT search_index_versions_status_check CHECK (
    status IN ('building', 'active', 'retired', 'failed')
  ),
  CONSTRAINT search_index_versions_count_check CHECK (document_count >= 0)
);

ALTER SEQUENCE search_index_version_seq OWNED BY search_index_versions.version;

CREATE UNIQUE INDEX search_index_versions_one_active
  ON search_index_versions (status)
  WHERE status = 'active';

CREATE UNIQUE INDEX search_index_versions_one_building
  ON search_index_versions (status)
  WHERE status = 'building';

CREATE TABLE search_documents (
  index_version INTEGER NOT NULL,
  movie_id UUID NOT NULL,
  status TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  alternate_keys TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  title_text TEXT NOT NULL,
  people_text TEXT NOT NULL DEFAULT '',
  genre_slugs TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  language_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  country_codes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  person_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  collection_slug TEXT,
  release_year SMALLINT,
  popularity NUMERIC(14, 4),
  search_vector tsvector NOT NULL,
  document JSONB NOT NULL,
  built_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT search_documents_pkey PRIMARY KEY (index_version, movie_id),
  CONSTRAINT search_documents_index_version_fkey
    FOREIGN KEY (index_version) REFERENCES search_index_versions (version)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT search_documents_movie_id_fkey
    FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT search_documents_status_check CHECK (status IN ('draft', 'active', 'archived')),
  CONSTRAINT search_documents_document_check CHECK (jsonb_typeof(document) = 'object'),
  CONSTRAINT search_documents_title_text_check CHECK (char_length(title_text) <= 4000)
);

COMMENT ON TABLE search_documents IS
  'Derived search documents. Rebuild them from movies if this table is emptied.';

CREATE INDEX search_documents_vector_idx
  ON search_documents USING GIN (search_vector);

CREATE INDEX search_documents_title_trgm_idx
  ON search_documents USING GIN (title_text gin_trgm_ops);

CREATE INDEX search_documents_people_trgm_idx
  ON search_documents USING GIN (people_text gin_trgm_ops);

CREATE INDEX search_documents_genre_idx
  ON search_documents USING GIN (genre_slugs);

CREATE INDEX search_documents_person_idx
  ON search_documents USING GIN (person_ids);

CREATE INDEX search_documents_active_idx
  ON search_documents (index_version, status, release_year);

CREATE TABLE search_query_stats (
  normalized_query TEXT PRIMARY KEY,
  search_count INTEGER NOT NULL DEFAULT 0,
  zero_result_count INTEGER NOT NULL DEFAULT 0,
  total_duration_ms BIGINT NOT NULL DEFAULT 0,
  last_searched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT search_query_stats_query_check CHECK (char_length(normalized_query) BETWEEN 1 AND 80),
  CONSTRAINT search_query_stats_counts_check CHECK (
    search_count >= 0 AND zero_result_count >= 0 AND total_duration_ms >= 0
  )
);

COMMENT ON TABLE search_query_stats IS
  'Aggregate query counts only. No user, session, or address is stored.';

CREATE TABLE search_reindex_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'pending',
  index_version INTEGER,
  processed INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  CONSTRAINT search_reindex_jobs_status_check CHECK (
    status IN ('pending', 'processing', 'completed', 'failed')
  ),
  CONSTRAINT search_reindex_jobs_processed_check CHECK (processed >= 0)
);

CREATE UNIQUE INDEX search_reindex_jobs_one_pending
  ON search_reindex_jobs (status)
  WHERE status = 'pending';
