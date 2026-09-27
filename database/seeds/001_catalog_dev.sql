-- Development-only catalog examples.
-- Public-domain films and https://example.com references. Not production media.

INSERT INTO languages (id, code, name) VALUES
  ('11111111-1111-4111-8111-111111111101', 'en', 'English'),
  ('11111111-1111-4111-8111-111111111102', 'de', 'German'),
  ('11111111-1111-4111-8111-111111111103', 'fr', 'French')
ON CONFLICT (id) DO NOTHING;

INSERT INTO countries (id, code, name, slug, display_name, rail_title, region, active, priority) VALUES
  ('22222222-2222-4222-8222-222222222201', 'US', 'United States', 'usa', 'United States', 'American Movies', 'North America', TRUE, TRUE),
  ('22222222-2222-4222-8222-222222222202', 'DE', 'Germany', 'germany', 'Germany', 'German Movies', 'Europe', TRUE, FALSE),
  ('22222222-2222-4222-8222-222222222203', 'FR', 'France', 'france', 'France', 'French Movies', 'Europe', TRUE, FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO genres (id, name, slug) VALUES
  ('33333333-3333-4333-8333-333333333301', 'Action', 'action'),
  ('33333333-3333-4333-8333-333333333302', 'Comedy', 'comedy'),
  ('33333333-3333-4333-8333-333333333303', 'Drama', 'drama'),
  ('33333333-3333-4333-8333-333333333304', 'Animation', 'animation'),
  ('33333333-3333-4333-8333-333333333305', 'Documentary', 'documentary'),
  ('33333333-3333-4333-8333-333333333306', 'Horror', 'horror'),
  ('33333333-3333-4333-8333-333333333307', 'Thriller', 'thriller'),
  ('33333333-3333-4333-8333-333333333308', 'Science Fiction', 'science-fiction')
ON CONFLICT (id) DO NOTHING;

INSERT INTO tags (id, name, slug) VALUES
  ('99999999-9999-4999-8999-999999999901', 'Public domain', 'public-domain'),
  ('99999999-9999-4999-8999-999999999902', 'Silent film', 'silent-film'),
  ('99999999-9999-4999-8999-999999999903', 'Expressionism', 'expressionism')
ON CONFLICT (id) DO NOTHING;

INSERT INTO people (id, name, birth_date, death_date, profile_image_url) VALUES
  ('44444444-4444-4444-8444-444444444401', 'F. W. Murnau', '1888-12-28', '1931-03-11', 'https://images.example.com/beezmovies/people/fw-murnau.jpg'),
  ('44444444-4444-4444-8444-444444444402', 'Max Schreck', '1879-09-06', '1936-02-20', NULL),
  ('44444444-4444-4444-8444-444444444403', 'Robert Wiene', '1873-04-27', '1938-07-17', NULL),
  ('44444444-4444-4444-8444-444444444404', 'Conrad Veidt', '1893-01-22', '1943-04-03', NULL),
  ('44444444-4444-4444-8444-444444444405', 'George A. Romero', '1940-02-04', '2017-07-16', NULL),
  ('44444444-4444-4444-8444-444444444406', 'Duane Jones', '1936-02-02', '1988-07-22', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalog_sources (id, name, slug, source_type, status, external_reference) VALUES
  ('77777777-7777-4777-8777-777777777701', 'Development seed', 'development-seed', 'editorial', 'active', 'dev-seed'),
  ('77777777-7777-4777-8777-777777777702', 'Example metadata', 'example-metadata', 'metadata', 'inactive', 'example-metadata')
ON CONFLICT (id) DO NOTHING;

INSERT INTO providers (id, name, slug, provider_type, status, capabilities, configuration) VALUES
  (
    '88888888-8888-4888-8888-888888888801',
    'Example Media',
    'example-media',
    'media',
    'active',
    '{"media_types":["stream"],"placeholder":true}'::jsonb,
    '{}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO collections (id, name, slug, description, poster_url) VALUES
  (
    '66666666-6666-4666-8666-666666666601',
    'Expressionist Shadows',
    'expressionist-shadows',
    'A development collection of public-domain expressionist films.',
    'https://images.example.com/beezmovies/collections/expressionist-shadows.jpg'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO movies (
  id,
  canonical_title,
  original_title,
  slug,
  synopsis,
  tagline,
  release_date,
  release_year,
  runtime_minutes,
  status,
  adult,
  original_language_id,
  popularity,
  content_type_id
) VALUES
  (
    '55555555-5555-4555-8555-555555555501',
    'Nosferatu',
    'Nosferatu, eine Symphonie des Grauens',
    'nosferatu',
    'A public-domain silent horror film used as development catalog data.',
    'A symphony of horror',
    '1922-03-15',
    1922,
    94,
    'active',
    FALSE,
    '11111111-1111-4111-8111-111111111102',
    80.5,
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
  ),
  (
    '55555555-5555-4555-8555-555555555502',
    'The Cabinet of Dr. Caligari',
    'Das Cabinet des Dr. Caligari',
    'the-cabinet-of-dr-caligari',
    'A public-domain silent film used as development catalog data.',
    NULL,
    '1920-02-26',
    1920,
    76,
    'active',
    FALSE,
    '11111111-1111-4111-8111-111111111102',
    70.0,
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
  ),
  (
    '55555555-5555-4555-8555-555555555503',
    'Night of the Living Dead',
    NULL,
    'night-of-the-living-dead',
    'A public-domain horror film used as development catalog data.',
    NULL,
    '1968-10-01',
    1968,
    96,
    'active',
    FALSE,
    '11111111-1111-4111-8111-111111111101',
    88.0,
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO alternate_titles (id, movie_id, title, language_id, country_id, catalog_source_id) VALUES
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    '55555555-5555-4555-8555-555555555501',
    'Nosferatu: A Symphony of Horror',
    '11111111-1111-4111-8111-111111111101',
    '22222222-2222-4222-8222-222222222201',
    '77777777-7777-4777-8777-777777777701'
  ),
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    '55555555-5555-4555-8555-555555555502',
    'Das Cabinet des Dr. Caligari',
    '11111111-1111-4111-8111-111111111102',
    '22222222-2222-4222-8222-222222222202',
    '77777777-7777-4777-8777-777777777701'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO movie_genres (movie_id, genre_id) VALUES
  ('55555555-5555-4555-8555-555555555501', '33333333-3333-4333-8333-333333333306'),
  ('55555555-5555-4555-8555-555555555502', '33333333-3333-4333-8333-333333333306'),
  ('55555555-5555-4555-8555-555555555502', '33333333-3333-4333-8333-333333333307'),
  ('55555555-5555-4555-8555-555555555503', '33333333-3333-4333-8333-333333333306')
ON CONFLICT DO NOTHING;

INSERT INTO movie_languages (movie_id, language_id) VALUES
  ('55555555-5555-4555-8555-555555555501', '11111111-1111-4111-8111-111111111102'),
  ('55555555-5555-4555-8555-555555555502', '11111111-1111-4111-8111-111111111102'),
  ('55555555-5555-4555-8555-555555555503', '11111111-1111-4111-8111-111111111101')
ON CONFLICT DO NOTHING;

INSERT INTO movie_countries (movie_id, country_id) VALUES
  ('55555555-5555-4555-8555-555555555501', '22222222-2222-4222-8222-222222222202'),
  ('55555555-5555-4555-8555-555555555502', '22222222-2222-4222-8222-222222222202'),
  ('55555555-5555-4555-8555-555555555503', '22222222-2222-4222-8222-222222222201')
ON CONFLICT DO NOTHING;

INSERT INTO movie_tags (movie_id, tag_id) VALUES
  ('55555555-5555-4555-8555-555555555501', '99999999-9999-4999-8999-999999999901'),
  ('55555555-5555-4555-8555-555555555501', '99999999-9999-4999-8999-999999999902'),
  ('55555555-5555-4555-8555-555555555501', '99999999-9999-4999-8999-999999999903'),
  ('55555555-5555-4555-8555-555555555502', '99999999-9999-4999-8999-999999999901'),
  ('55555555-5555-4555-8555-555555555502', '99999999-9999-4999-8999-999999999903'),
  ('55555555-5555-4555-8555-555555555503', '99999999-9999-4999-8999-999999999901')
ON CONFLICT DO NOTHING;

INSERT INTO movie_credits (
  id, movie_id, person_id, department, job, character_name, billing_order, catalog_source_id
) VALUES
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    '55555555-5555-4555-8555-555555555501',
    '44444444-4444-4444-8444-444444444401',
    'Directing',
    'Director',
    NULL,
    0,
    '77777777-7777-4777-8777-777777777701'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    '55555555-5555-4555-8555-555555555501',
    '44444444-4444-4444-8444-444444444402',
    'Acting',
    'Actor',
    'Count Orlok',
    1,
    '77777777-7777-4777-8777-777777777701'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3',
    '55555555-5555-4555-8555-555555555502',
    '44444444-4444-4444-8444-444444444403',
    'Directing',
    'Director',
    NULL,
    0,
    '77777777-7777-4777-8777-777777777701'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4',
    '55555555-5555-4555-8555-555555555502',
    '44444444-4444-4444-8444-444444444404',
    'Acting',
    'Actor',
    'Cesare',
    1,
    '77777777-7777-4777-8777-777777777701'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5',
    '55555555-5555-4555-8555-555555555503',
    '44444444-4444-4444-8444-444444444405',
    'Directing',
    'Director',
    NULL,
    0,
    '77777777-7777-4777-8777-777777777701'
  ),
  (
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6',
    '55555555-5555-4555-8555-555555555503',
    '44444444-4444-4444-8444-444444444406',
    'Acting',
    'Actor',
    'Ben',
    1,
    '77777777-7777-4777-8777-777777777701'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO collection_movies (collection_id, movie_id, sort_order) VALUES
  ('66666666-6666-4666-8666-666666666601', '55555555-5555-4555-8555-555555555501', 1),
  ('66666666-6666-4666-8666-666666666601', '55555555-5555-4555-8555-555555555502', 2)
ON CONFLICT DO NOTHING;

INSERT INTO external_identifiers (id, movie_id, catalog_source_id, external_id) VALUES
  (
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    '55555555-5555-4555-8555-555555555501',
    '77777777-7777-4777-8777-777777777701',
    'dev-seed:movie:nosferatu'
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
    '55555555-5555-4555-8555-555555555501',
    '77777777-7777-4777-8777-777777777702',
    'example-metadata:nosferatu'
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
    '55555555-5555-4555-8555-555555555502',
    '77777777-7777-4777-8777-777777777701',
    'dev-seed:movie:caligari'
  ),
  (
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc4',
    '55555555-5555-4555-8555-555555555503',
    '77777777-7777-4777-8777-777777777701',
    'dev-seed:movie:night-of-the-living-dead'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO movie_ratings (id, movie_id, catalog_source_id, label, value, scale, vote_count) VALUES
  (
    'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
    '55555555-5555-4555-8555-555555555501',
    '77777777-7777-4777-8777-777777777701',
    'editorial',
    8.200,
    10,
    1
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO movie_images (
  id, movie_id, image_type, url, width, height, language_id, catalog_source_id, priority
) VALUES
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
    '55555555-5555-4555-8555-555555555501',
    'poster',
    'https://images.example.com/beezmovies/posters/nosferatu.jpg',
    1000,
    1500,
    NULL,
    '77777777-7777-4777-8777-777777777701',
    0
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
    '55555555-5555-4555-8555-555555555501',
    'backdrop',
    'https://images.example.com/beezmovies/backdrops/nosferatu.jpg',
    1920,
    1080,
    NULL,
    '77777777-7777-4777-8777-777777777701',
    0
  ),
  (
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3',
    '55555555-5555-4555-8555-555555555503',
    'poster',
    'https://images.example.com/beezmovies/posters/night-of-the-living-dead.jpg',
    1000,
    1500,
    '11111111-1111-4111-8111-111111111101',
    '77777777-7777-4777-8777-777777777701',
    0
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO movie_videos (
  id, movie_id, video_type, host_name, external_id, url, language_id, official, duration_seconds, priority
) VALUES
  (
    'ffffffff-ffff-4fff-8fff-fffffffffff1',
    '55555555-5555-4555-8555-555555555501',
    'trailer',
    'example',
    'dev-seed:trailer:nosferatu',
    'https://videos.example.com/beezmovies/trailers/nosferatu',
    '11111111-1111-4111-8111-111111111102',
    TRUE,
    90,
    0
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO media_references (
  id,
  movie_id,
  provider_id,
  external_reference,
  media_type,
  quality,
  duration_seconds,
  status,
  availability_status,
  rights_status,
  metadata,
  last_checked_at
) VALUES
  (
    '12121212-1212-4212-8212-121212121201',
    '55555555-5555-4555-8555-555555555501',
    '88888888-8888-4888-8888-888888888801',
    'dev-seed:nosferatu:1080p',
    'stream',
    '1080p',
    5640,
    'available',
    'available',
    'AUTHORIZED',
    '{"note":"development placeholder, not a media file"}'::jsonb,
    NOW()
  ),
  (
    '12121212-1212-4212-8212-121212121202',
    '55555555-5555-4555-8555-555555555503',
    '88888888-8888-4888-8888-888888888801',
    'dev-seed:night-of-the-living-dead:720p',
    'stream',
    '720p',
    5760,
    'pending',
    'unknown',
    'PENDING_REVIEW',
    '{"note":"development placeholder, not a media file"}'::jsonb,
    NULL
  ),
  (
    '12121212-1212-4212-8212-121212121203',
    '55555555-5555-4555-8555-555555555501',
    '88888888-8888-4888-8888-888888888802',
    'dev:ok:nosferatu',
    'download',
    '1080p',
    5640,
    'available',
    'available',
    'AUTHORIZED',
    '{"format":"development-text"}'::jsonb,
    NOW()
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalog_sources (id, name, slug, source_type, status, external_reference) VALUES
  (
    '77777777-7777-4777-8777-777777777703',
    'Development metadata',
    'development-metadata',
    'metadata',
    'active',
    'development-metadata'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO catalog_source_runtime (
  catalog_source_id,
  health_status,
  requests_per_minute,
  min_interval_ms,
  concurrency_limit,
  priority,
  allowed_hosts
) VALUES (
  '77777777-7777-4777-8777-777777777703',
  'healthy',
  30,
  0,
  2,
  40,
  ARRAY['images.example.com', 'videos.example.com']::text[]
)
ON CONFLICT (catalog_source_id) DO NOTHING;

INSERT INTO ingestion_schedules (name, catalog_source_id, schedule_type, interval_seconds, enabled) VALUES
  ('development-metadata-import', '77777777-7777-4777-8777-777777777703', 'initial_import', 86400, FALSE),
  ('development-metadata-periodic', '77777777-7777-4777-8777-777777777703', 'periodic_update', 86400, FALSE),
  ('development-metadata-discovery', '77777777-7777-4777-8777-777777777703', 'discovery', 86400, FALSE),
  ('development-metadata-refresh', '77777777-7777-4777-8777-777777777703', 'stale_refresh', 604800, FALSE),
  ('development-metadata-retry', '77777777-7777-4777-8777-777777777703', 'failed_retry', 3600, FALSE),
  ('development-metadata-health', '77777777-7777-4777-8777-777777777703', 'source_health', 3600, FALSE)
ON CONFLICT (name) DO NOTHING;
