-- Homepage rail configuration. Movie rows stay in the catalog.

CREATE TABLE homepage_rails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_slug TEXT,
  sort_order INTEGER NOT NULL,
  item_limit INTEGER NOT NULL DEFAULT 12,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  cache_seconds INTEGER NOT NULL DEFAULT 60,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT homepage_rails_slug_key UNIQUE (slug),
  CONSTRAINT homepage_rails_slug_format_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT homepage_rails_title_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 80),
  CONSTRAINT homepage_rails_source_type_check CHECK (
    source_type IN ('featured', 'recent', 'trending', 'genres', 'collections', 'collection')
  ),
  CONSTRAINT homepage_rails_source_slug_check CHECK (
    (source_type = 'collection' AND source_slug IS NOT NULL)
    OR (source_type <> 'collection' AND source_slug IS NULL)
  ),
  CONSTRAINT homepage_rails_item_limit_check CHECK (item_limit BETWEEN 1 AND 24),
  CONSTRAINT homepage_rails_cache_seconds_check CHECK (cache_seconds BETWEEN 15 AND 3600)
);

CREATE TRIGGER homepage_rails_set_updated_at
BEFORE UPDATE ON homepage_rails
FOR EACH ROW
EXECUTE FUNCTION catalog_set_updated_at();

INSERT INTO homepage_rails (
  id, slug, title, source_type, source_slug, sort_order, item_limit, enabled, cache_seconds
) VALUES
  ('15151515-1515-4515-8515-151515151501', 'featured', 'Featured', 'featured', NULL, 10, 12, TRUE, 300),
  ('15151515-1515-4515-8515-151515151502', 'recent', 'Recently added', 'recent', NULL, 20, 12, TRUE, 60),
  ('15151515-1515-4515-8515-151515151503', 'trending', 'Trending', 'trending', NULL, 30, 12, TRUE, 300),
  ('15151515-1515-4515-8515-151515151504', 'genres', 'Genres', 'genres', NULL, 40, 12, TRUE, 300),
  ('15151515-1515-4515-8515-151515151505', 'collections', 'Collections', 'collections', NULL, 50, 8, TRUE, 300),
  ('15151515-1515-4515-8515-151515151506', 'expressionist-shadows', 'Expressionist Shadows', 'collection', 'expressionist-shadows', 15, 12, TRUE, 300);
