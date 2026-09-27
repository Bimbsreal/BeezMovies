-- Catalog core entities.
-- PostgreSQL is the source of truth. These tables store metadata and references only.

CREATE OR REPLACE FUNCTION catalog_normalize_text(input TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF(
    regexp_replace(lower(btrim(coalesce(input, ''))), '[^a-z0-9]+', '', 'g'),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION catalog_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE languages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT languages_code_key UNIQUE (code),
  CONSTRAINT languages_code_format_check CHECK (code ~ '^[a-z]{2,3}(-[a-z0-9]{2,8})*$'),
  CONSTRAINT languages_name_check CHECK (btrim(name) <> '')
);

CREATE TABLE countries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT countries_code_key UNIQUE (code),
  CONSTRAINT countries_code_format_check CHECK (code ~ '^[A-Z]{2}$'),
  CONSTRAINT countries_name_check CHECK (btrim(name) <> '')
);

CREATE TABLE genres (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT genres_slug_key UNIQUE (slug),
  CONSTRAINT genres_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT genres_slug_format_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

CREATE TRIGGER genres_set_updated_at
BEFORE UPDATE ON genres
FOR EACH ROW
EXECUTE FUNCTION catalog_set_updated_at();

CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tags_slug_key UNIQUE (slug),
  CONSTRAINT tags_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT tags_slug_format_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

CREATE TRIGGER tags_set_updated_at
BEFORE UPDATE ON tags
FOR EACH ROW
EXECUTE FUNCTION catalog_set_updated_at();

CREATE TABLE people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  normalized_name TEXT GENERATED ALWAYS AS (catalog_normalize_text(name)) STORED NOT NULL,
  biography TEXT,
  birth_date DATE,
  death_date DATE,
  profile_image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT people_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT people_dates_check CHECK (
    death_date IS NULL OR birth_date IS NULL OR death_date >= birth_date
  ),
  CONSTRAINT people_profile_url_check CHECK (
    profile_image_url IS NULL OR profile_image_url ~ '^https://'
  )
);

CREATE TRIGGER people_set_updated_at
BEFORE UPDATE ON people
FOR EACH ROW
EXECUTE FUNCTION catalog_set_updated_at();

CREATE TABLE catalog_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  source_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  external_reference TEXT,
  last_synchronized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT catalog_sources_slug_key UNIQUE (slug),
  CONSTRAINT catalog_sources_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT catalog_sources_slug_format_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT catalog_sources_type_check CHECK (source_type IN ('metadata', 'editorial', 'import')),
  CONSTRAINT catalog_sources_status_check CHECK (status IN ('active', 'inactive', 'archived')),
  CONSTRAINT catalog_sources_archive_state_check CHECK (
    (status = 'archived' AND archived_at IS NOT NULL)
    OR (status <> 'archived' AND archived_at IS NULL)
  )
);

CREATE TRIGGER catalog_sources_set_updated_at
BEFORE UPDATE ON catalog_sources
FOR EACH ROW
EXECUTE FUNCTION catalog_set_updated_at();

CREATE TABLE providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'inactive',
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT providers_slug_key UNIQUE (slug),
  CONSTRAINT providers_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT providers_slug_format_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT providers_type_check CHECK (provider_type IN ('metadata', 'media', 'hybrid')),
  CONSTRAINT providers_status_check CHECK (status IN ('active', 'inactive', 'archived')),
  CONSTRAINT providers_archive_state_check CHECK (
    (status = 'archived' AND archived_at IS NOT NULL)
    OR (status <> 'archived' AND archived_at IS NULL)
  ),
  CONSTRAINT providers_capabilities_object_check CHECK (jsonb_typeof(capabilities) = 'object'),
  CONSTRAINT providers_configuration_object_check CHECK (jsonb_typeof(configuration) = 'object'),
  CONSTRAINT providers_configuration_secrets_check CHECK (
    NOT (configuration ?| ARRAY['password', 'secret', 'token', 'api_key', 'apiKey', 'client_secret'])
  )
);

COMMENT ON COLUMN providers.configuration IS
  'Non-secret provider settings only. API credentials belong in server environment configuration.';

CREATE TRIGGER providers_set_updated_at
BEFORE UPDATE ON providers
FOR EACH ROW
EXECUTE FUNCTION catalog_set_updated_at();

CREATE TABLE collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  poster_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT collections_slug_key UNIQUE (slug),
  CONSTRAINT collections_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT collections_slug_format_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT collections_poster_url_check CHECK (
    poster_url IS NULL OR poster_url ~ '^https://'
  )
);

CREATE TRIGGER collections_set_updated_at
BEFORE UPDATE ON collections
FOR EACH ROW
EXECUTE FUNCTION catalog_set_updated_at();

CREATE TABLE movies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_title TEXT NOT NULL,
  normalized_title TEXT GENERATED ALWAYS AS (catalog_normalize_text(canonical_title)) STORED NOT NULL,
  original_title TEXT,
  slug TEXT NOT NULL,
  synopsis TEXT,
  tagline TEXT,
  release_date DATE,
  release_year SMALLINT,
  runtime_minutes INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  adult BOOLEAN NOT NULL DEFAULT FALSE,
  original_language_id UUID,
  popularity NUMERIC(14, 4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CONSTRAINT movies_slug_key UNIQUE (slug),
  CONSTRAINT movies_title_check CHECK (btrim(canonical_title) <> ''),
  CONSTRAINT movies_slug_format_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT movies_status_check CHECK (status IN ('draft', 'active', 'archived')),
  CONSTRAINT movies_archive_state_check CHECK (
    (status = 'archived' AND archived_at IS NOT NULL)
    OR (status <> 'archived' AND archived_at IS NULL)
  ),
  CONSTRAINT movies_release_year_check CHECK (
    release_year IS NULL OR release_year BETWEEN 1888 AND 2100
  ),
  CONSTRAINT movies_release_consistency_check CHECK (
    release_date IS NULL
    OR release_year IS NULL
    OR release_year = EXTRACT(YEAR FROM release_date)::SMALLINT
  ),
  CONSTRAINT movies_runtime_check CHECK (
    runtime_minutes IS NULL OR runtime_minutes > 0
  ),
  CONSTRAINT movies_original_language_id_fkey
    FOREIGN KEY (original_language_id) REFERENCES languages (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TRIGGER movies_set_updated_at
BEFORE UPDATE ON movies
FOR EACH ROW
EXECUTE FUNCTION catalog_set_updated_at();

COMMENT ON TABLE movies IS
  'Canonical movie records. Search indexes, Redis, and CDN copies are derived from this table.';
