-- Editorial states stay off the public catalog until a movie is active.

ALTER TABLE movies DROP CONSTRAINT movies_status_check;

ALTER TABLE movies
  ADD CONSTRAINT movies_status_check
  CHECK (status IN ('draft', 'review', 'approved', 'active', 'archived'));

ALTER TABLE admin_operations DROP CONSTRAINT admin_operations_action_check;

ALTER TABLE admin_operations
  ADD CONSTRAINT admin_operations_action_check
  CHECK (action IN (
    'publish', 'unpublish', 'archive', 'reindex',
    'assignGenre', 'assignCountry', 'assignCollection'
  ));

INSERT INTO roles (id, slug, name) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa8', 'content_admin', 'Content admin'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9', 'moderator', 'Moderator')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON (
  (r.slug = 'content_admin' AND p.slug IN ('admin.access', 'admin.catalog'))
  OR (r.slug = 'moderator' AND p.slug = 'admin.access')
)
ON CONFLICT DO NOTHING;
