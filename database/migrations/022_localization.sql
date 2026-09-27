-- Localization stays beside the source title and synopsis. It does not replace them.

ALTER TABLE languages
  ADD COLUMN direction TEXT NOT NULL DEFAULT 'ltr',
  ADD COLUMN ui_ready BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE languages
  ADD CONSTRAINT languages_direction_check CHECK (direction IN ('ltr', 'rtl'));

UPDATE languages
SET direction = 'ltr',
    ui_ready = (code = 'en');

ALTER TABLE alternate_titles
  ADD COLUMN status TEXT NOT NULL DEFAULT 'review';

ALTER TABLE alternate_titles
  ADD CONSTRAINT alternate_titles_status_check CHECK (status IN ('verified', 'review', 'unavailable'));

UPDATE alternate_titles
SET status = 'verified';

CREATE INDEX idx_alternate_titles_movie_status ON alternate_titles (movie_id, status);

CREATE TABLE movie_synopses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id UUID NOT NULL,
  language_id UUID NOT NULL,
  synopsis TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'review',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT movie_synopses_movie_id_fkey
    FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT movie_synopses_language_id_fkey
    FOREIGN KEY (language_id) REFERENCES languages (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT movie_synopses_movie_language_key UNIQUE (movie_id, language_id),
  CONSTRAINT movie_synopses_status_check CHECK (status IN ('verified', 'review', 'unavailable')),
  CONSTRAINT movie_synopses_text_check CHECK (char_length(btrim(synopsis)) BETWEEN 1 AND 4000)
);

CREATE INDEX idx_movie_synopses_language_id ON movie_synopses (language_id);
CREATE INDEX idx_movie_synopses_status ON movie_synopses (status);
