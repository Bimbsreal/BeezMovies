-- Image, trailer, and provider-agnostic media references.
-- Rows store URLs and identifiers. Binary media is not stored here.

CREATE TABLE movie_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID NOT NULL,
  image_type TEXT NOT NULL,
  url TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  language_id UUID,
  catalog_source_id UUID,
  priority INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT movie_images_type_check CHECK (
    image_type IN ('poster', 'backdrop', 'logo', 'still', 'thumbnail')
  ),
  CONSTRAINT movie_images_url_check CHECK (
    url ~ '^https://' AND octet_length(url) <= 2048 AND url !~ '^data:'
  ),
  CONSTRAINT movie_images_width_check CHECK (width IS NULL OR width > 0),
  CONSTRAINT movie_images_height_check CHECK (height IS NULL OR height > 0),
  CONSTRAINT movie_images_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT movie_images_movie_id_fkey
    FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT movie_images_language_id_fkey
    FOREIGN KEY (language_id) REFERENCES languages (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT movie_images_catalog_source_id_fkey
    FOREIGN KEY (catalog_source_id) REFERENCES catalog_sources (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE movie_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID NOT NULL,
  video_type TEXT NOT NULL,
  host_name TEXT,
  external_id TEXT,
  url TEXT,
  language_id UUID,
  catalog_source_id UUID,
  official BOOLEAN NOT NULL DEFAULT FALSE,
  duration_seconds INTEGER,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT movie_videos_type_check CHECK (
    video_type IN ('trailer', 'teaser', 'clip', 'featurette')
  ),
  CONSTRAINT movie_videos_reference_check CHECK (
    url IS NOT NULL OR external_id IS NOT NULL
  ),
  CONSTRAINT movie_videos_url_check CHECK (
    url IS NULL OR (url ~ '^https://' AND octet_length(url) <= 2048 AND url !~ '^data:')
  ),
  CONSTRAINT movie_videos_duration_check CHECK (
    duration_seconds IS NULL OR duration_seconds > 0
  ),
  CONSTRAINT movie_videos_movie_id_fkey
    FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT movie_videos_language_id_fkey
    FOREIGN KEY (language_id) REFERENCES languages (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT movie_videos_catalog_source_id_fkey
    FOREIGN KEY (catalog_source_id) REFERENCES catalog_sources (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TRIGGER movie_videos_set_updated_at
BEFORE UPDATE ON movie_videos
FOR EACH ROW
EXECUTE FUNCTION catalog_set_updated_at();

CREATE TABLE media_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID NOT NULL,
  provider_id UUID NOT NULL,
  external_reference TEXT NOT NULL,
  media_type TEXT NOT NULL,
  quality TEXT,
  file_size_bytes BIGINT,
  duration_seconds INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  availability_status TEXT NOT NULL DEFAULT 'unknown',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_checked_at TIMESTAMPTZ,
  CONSTRAINT media_references_provider_reference_key UNIQUE (provider_id, external_reference),
  CONSTRAINT media_references_external_reference_check CHECK (btrim(external_reference) <> ''),
  CONSTRAINT media_references_media_type_check CHECK (
    media_type IN ('stream', 'download', 'embed')
  ),
  CONSTRAINT media_references_file_size_check CHECK (
    file_size_bytes IS NULL OR file_size_bytes >= 0
  ),
  CONSTRAINT media_references_duration_check CHECK (
    duration_seconds IS NULL OR duration_seconds > 0
  ),
  CONSTRAINT media_references_status_check CHECK (
    status IN ('pending', 'available', 'unavailable', 'archived')
  ),
  CONSTRAINT media_references_availability_check CHECK (
    availability_status IN ('unknown', 'available', 'unavailable', 'region_restricted')
  ),
  CONSTRAINT media_references_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT media_references_movie_id_fkey
    FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT media_references_provider_id_fkey
    FOREIGN KEY (provider_id) REFERENCES providers (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

COMMENT ON TABLE media_references IS
  'Provider-agnostic pointers to authorized media. Do not store file bytes or provider secrets.';

CREATE TRIGGER media_references_set_updated_at
BEFORE UPDATE ON media_references
FOR EACH ROW
EXECUTE FUNCTION catalog_set_updated_at();
