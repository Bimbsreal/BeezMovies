-- Optional personal library. Movie rows stay in the catalog.
-- These tables store only the user and the movie relationship.

CREATE TABLE user_watchlist (
  user_id UUID NOT NULL,
  movie_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, movie_id),
  CONSTRAINT user_watchlist_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT user_watchlist_movie_id_fkey
    FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE user_favorites (
  user_id UUID NOT NULL,
  movie_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, movie_id),
  CONSTRAINT user_favorites_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT user_favorites_movie_id_fkey
    FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE user_recent_views (
  user_id UUID NOT NULL,
  movie_id UUID NOT NULL,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, movie_id),
  CONSTRAINT user_recent_views_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT user_recent_views_movie_id_fkey
    FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE user_preferences (
  user_id UUID PRIMARY KEY,
  preferred_genres TEXT[] NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT user_preferences_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT user_preferences_genres_limit CHECK (cardinality(preferred_genres) <= 8)
);

CREATE TRIGGER user_preferences_set_updated_at
BEFORE UPDATE ON user_preferences
FOR EACH ROW
EXECUTE FUNCTION catalog_set_updated_at();
