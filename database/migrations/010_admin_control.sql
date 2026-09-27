-- Private admin control plane. Public catalog status values stay draft/active/archived.

INSERT INTO roles (id, slug, name) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'super_admin', 'Super admin')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO permissions (id, slug, description) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', 'admin.catalog', 'Manage catalog, media, providers, ingestion, and search'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6', 'admin.users', 'Inspect accounts and change account status'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7', 'admin.roles', 'Change account roles')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON (
  (r.slug = 'admin' AND p.slug IN ('admin.access', 'admin.catalog', 'admin.users'))
  OR (r.slug = 'super_admin' AND p.slug IN ('admin.access', 'admin.catalog', 'admin.users', 'admin.roles'))
)
ON CONFLICT DO NOTHING;

ALTER TABLE genres
  ADD COLUMN archived_at TIMESTAMPTZ;

ALTER TABLE catalog_field_provenance
  ADD COLUMN origin TEXT NOT NULL DEFAULT 'source';

ALTER TABLE catalog_field_provenance
  ADD CONSTRAINT catalog_field_provenance_origin_check CHECK (origin IN ('source', 'manual'));

INSERT INTO catalog_sources (
  id, name, slug, source_type, status, external_reference
) VALUES (
  '99999999-9999-4999-8999-999999999901',
  'Manual curation',
  'manual',
  'editorial',
  'inactive',
  'admin'
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO catalog_source_runtime (catalog_source_id, priority, health_status)
VALUES ('99999999-9999-4999-8999-999999999901', 1000, 'healthy')
ON CONFLICT (catalog_source_id) DO NOTHING;

CREATE TABLE admin_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  result TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT admin_audit_events_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT admin_audit_events_action_check CHECK (action ~ '^[A-Z0-9_]{3,80}$'),
  CONSTRAINT admin_audit_events_target_check CHECK (target_type ~ '^[a-z0-9_]{2,40}$'),
  CONSTRAINT admin_audit_events_result_check CHECK (result IN ('success', 'failed')),
  CONSTRAINT admin_audit_events_metadata_check CHECK (
    jsonb_typeof(metadata) = 'object'
    AND NOT (metadata ?| ARRAY['password', 'password_hash', 'secret', 'token', 'api_key', 'apiKey'])
  )
);

CREATE INDEX admin_audit_events_created_idx
  ON admin_audit_events (created_at DESC);

COMMENT ON TABLE admin_audit_events IS
  'Administrative actions. Do not store passwords, hashes, or provider secrets.';

CREATE TABLE admin_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  total_count INTEGER NOT NULL,
  processed_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT admin_operations_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT admin_operations_action_check CHECK (action IN ('publish', 'archive', 'reindex')),
  CONSTRAINT admin_operations_status_check CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  CONSTRAINT admin_operations_counts_check CHECK (
    total_count BETWEEN 1 AND 100
    AND processed_count BETWEEN 0 AND total_count
  ),
  CONSTRAINT admin_operations_metadata_check CHECK (
    jsonb_typeof(metadata) = 'object'
    AND NOT (metadata ?| ARRAY['password', 'password_hash', 'secret', 'token', 'api_key', 'apiKey'])
  )
);

CREATE TABLE platform_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID,
  CONSTRAINT platform_settings_key_check CHECK (key ~ '^[a-z0-9_]{2,40}$'),
  CONSTRAINT platform_settings_value_check CHECK (
    jsonb_typeof(value) = 'object'
    AND NOT (value ?| ARRAY['password', 'password_hash', 'secret', 'token', 'api_key', 'apiKey'])
  ),
  CONSTRAINT platform_settings_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

INSERT INTO platform_settings (key, value) VALUES
  ('ops_note', '{"text":""}'::jsonb)
ON CONFLICT (key) DO NOTHING;
