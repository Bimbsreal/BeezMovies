-- Saved country preferences are chosen by the account. They are not inferred.

ALTER TABLE user_preferences
  ADD COLUMN preferred_countries TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE user_preferences
  ADD CONSTRAINT user_preferences_countries_limit CHECK (cardinality(preferred_countries) <= 8);
