-- Old public slugs can point at the current movie after an admin merge.
-- The canonical movies.slug value is not rewritten for ordinary metadata edits.

CREATE TABLE movie_slug_redirects (
  slug TEXT PRIMARY KEY,
  movie_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT movie_slug_redirects_slug_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT movie_slug_redirects_movie_id_fkey
    FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);
