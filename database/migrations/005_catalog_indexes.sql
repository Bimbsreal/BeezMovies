-- Search and relationship indexes. PostgreSQL does not index foreign keys automatically.
-- These btree indexes prepare catalog lookup. They are not a separate search service.

CREATE INDEX idx_movies_normalized_title ON movies (normalized_title);
CREATE INDEX idx_movies_canonical_title ON movies (canonical_title);
CREATE INDEX idx_movies_status ON movies (status);
CREATE INDEX idx_movies_release_date ON movies (release_date);
CREATE INDEX idx_movies_release_year ON movies (release_year);
CREATE INDEX idx_movies_dedup_title_year ON movies (normalized_title, release_year);
CREATE INDEX idx_movies_original_language_id ON movies (original_language_id);
CREATE INDEX idx_movies_active_release_date ON movies (release_date DESC)
  WHERE status = 'active' AND archived_at IS NULL;

CREATE INDEX idx_people_normalized_name ON people (normalized_name);

CREATE INDEX idx_alternate_titles_movie_id ON alternate_titles (movie_id);
CREATE INDEX idx_alternate_titles_normalized_title ON alternate_titles (normalized_title);
CREATE INDEX idx_alternate_titles_language_id ON alternate_titles (language_id);
CREATE INDEX idx_alternate_titles_country_id ON alternate_titles (country_id);
CREATE INDEX idx_alternate_titles_catalog_source_id ON alternate_titles (catalog_source_id);

CREATE INDEX idx_movie_genres_genre_id ON movie_genres (genre_id);
CREATE INDEX idx_movie_languages_language_id ON movie_languages (language_id);
CREATE INDEX idx_movie_countries_country_id ON movie_countries (country_id);
CREATE INDEX idx_movie_tags_tag_id ON movie_tags (tag_id);

CREATE INDEX idx_movie_credits_movie_id ON movie_credits (movie_id, department, billing_order);
CREATE INDEX idx_movie_credits_person_id ON movie_credits (person_id);
CREATE INDEX idx_movie_credits_catalog_source_id ON movie_credits (catalog_source_id);

CREATE INDEX idx_collection_movies_sort ON collection_movies (collection_id, sort_order);

CREATE INDEX idx_external_identifiers_external_id ON external_identifiers (external_id);

CREATE INDEX idx_movie_ratings_movie_id ON movie_ratings (movie_id);
CREATE INDEX idx_movie_ratings_catalog_source_id ON movie_ratings (catalog_source_id);

CREATE INDEX idx_movie_images_movie_type ON movie_images (movie_id, image_type, priority);
CREATE INDEX idx_movie_images_language_id ON movie_images (language_id);
CREATE INDEX idx_movie_images_catalog_source_id ON movie_images (catalog_source_id);

CREATE INDEX idx_movie_videos_movie_type ON movie_videos (movie_id, video_type, priority);
CREATE INDEX idx_movie_videos_language_id ON movie_videos (language_id);
CREATE INDEX idx_movie_videos_catalog_source_id ON movie_videos (catalog_source_id);

CREATE INDEX idx_media_references_movie_id ON media_references (movie_id);
CREATE INDEX idx_media_references_status ON media_references (status, availability_status);
