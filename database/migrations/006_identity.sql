-- Identity, sessions, and authentication audit.
-- Catalog tables are unchanged. PostgreSQL remains the source of truth.

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  normalized_email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  username TEXT,
  avatar_url TEXT,
  account_status TEXT NOT NULL DEFAULT 'pending_verification',
  email_verified_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT users_email_present CHECK (char_length(btrim(email)) > 0),
  CONSTRAINT users_normalized_email_lower CHECK (normalized_email = lower(normalized_email)),
  CONSTRAINT users_normalized_email_shape CHECK (position('@' IN normalized_email) > 1),
  CONSTRAINT users_password_hash_argon2id CHECK (password_hash LIKE '$argon2id$%'),
  CONSTRAINT users_display_name_length CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 80),
  CONSTRAINT users_username_shape CHECK (
    username IS NULL OR username ~ '^[a-z0-9_]{3,32}$'
  ),
  CONSTRAINT users_avatar_reference CHECK (
    avatar_url IS NULL
    OR (
      char_length(avatar_url) <= 2048
      AND avatar_url ~ '^https://'
    )
  ),
  CONSTRAINT users_account_status_known CHECK (
    account_status IN ('pending_verification', 'active', 'suspended', 'deactivated')
  )
);

CREATE UNIQUE INDEX users_normalized_email_active_uidx
  ON users (normalized_email)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX users_username_active_uidx
  ON users (username)
  WHERE username IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION catalog_set_updated_at();

COMMENT ON TABLE users IS
  'Account identity. Passwords are Argon2id hashes. Soft-delete through deleted_at.';

COMMENT ON COLUMN users.password_hash IS
  'Argon2id PHC string. Never store or return a plaintext password.';

CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT roles_slug_unique UNIQUE (slug),
  CONSTRAINT roles_slug_shape CHECK (slug ~ '^[a-z][a-z0-9_]{1,40}$'),
  CONSTRAINT roles_name_present CHECK (char_length(btrim(name)) BETWEEN 1 AND 80)
);

CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT permissions_slug_unique UNIQUE (slug),
  CONSTRAINT permissions_slug_shape CHECK (slug ~ '^[a-z][a-z0-9_.]{1,60}$'),
  CONSTRAINT permissions_description_present CHECK (char_length(btrim(description)) BETWEEN 1 AND 200)
);

CREATE TABLE role_permissions (
  role_id UUID NOT NULL,
  permission_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT role_permissions_role_id_fkey
    FOREIGN KEY (role_id) REFERENCES roles (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT role_permissions_permission_id_fkey
    FOREIGN KEY (permission_id) REFERENCES permissions (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX role_permissions_permission_id_idx
  ON role_permissions (permission_id);

CREATE TABLE user_roles (
  user_id UUID NOT NULL,
  role_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT user_roles_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT user_roles_role_id_fkey
    FOREIGN KEY (role_id) REFERENCES roles (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX user_roles_role_id_idx
  ON user_roles (role_id);

INSERT INTO roles (id, slug, name) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'user', 'User'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'admin', 'Admin')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO permissions (id, slug, description) VALUES
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
    'admin.access',
    'Access the administrative identity foundation'
  )
ON CONFLICT (slug) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id) VALUES
  (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'
  )
ON CONFLICT DO NOTHING;

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  user_agent TEXT,
  ip_address INET,
  CONSTRAINT sessions_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT sessions_expires_after_create CHECK (expires_at > created_at),
  CONSTRAINT sessions_revoke_after_create CHECK (
    revoked_at IS NULL OR revoked_at >= created_at
  ),
  CONSTRAINT sessions_revoke_reason_known CHECK (
    revoke_reason IS NULL
    OR revoke_reason IN ('logout', 'revoked', 'revoke_all', 'password_reset')
  ),
  CONSTRAINT sessions_user_agent_length CHECK (
    user_agent IS NULL OR char_length(user_agent) <= 512
  ),
  CONSTRAINT sessions_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX sessions_user_active_idx
  ON sessions (user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX sessions_expires_at_idx
  ON sessions (expires_at);

COMMENT ON COLUMN sessions.token_hash IS
  'SHA-256 of the session cookie. The raw token is never stored.';

CREATE TABLE email_verification_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT email_verification_tokens_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT email_verification_tokens_expires_after_create CHECK (expires_at > created_at),
  CONSTRAINT email_verification_tokens_used_after_create CHECK (
    used_at IS NULL OR used_at >= created_at
  ),
  CONSTRAINT email_verification_tokens_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX email_verification_tokens_user_id_idx
  ON email_verification_tokens (user_id);

CREATE INDEX email_verification_tokens_expires_at_idx
  ON email_verification_tokens (expires_at);

CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT password_reset_tokens_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT password_reset_tokens_expires_after_create CHECK (expires_at > created_at),
  CONSTRAINT password_reset_tokens_used_after_create CHECK (
    used_at IS NULL OR used_at >= created_at
  ),
  CONSTRAINT password_reset_tokens_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX password_reset_tokens_user_id_idx
  ON password_reset_tokens (user_id);

CREATE INDEX password_reset_tokens_expires_at_idx
  ON password_reset_tokens (expires_at);

COMMENT ON TABLE email_verification_tokens IS
  'Single-use email verification secrets. Only the SHA-256 hash is stored.';

COMMENT ON TABLE password_reset_tokens IS
  'Single-use password reset secrets. Only the SHA-256 hash is stored.';

CREATE TABLE auth_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  event_type TEXT NOT NULL,
  ip_address INET,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT auth_events_type_known CHECK (
    event_type IN (
      'registration',
      'login_success',
      'login_failure',
      'logout',
      'password_reset_requested',
      'password_reset_completed',
      'email_verification_sent',
      'email_verified',
      'session_revoked',
      'sessions_revoked',
      'admin_authenticated'
    )
  ),
  CONSTRAINT auth_events_user_agent_length CHECK (
    user_agent IS NULL OR char_length(user_agent) <= 512
  ),
  CONSTRAINT auth_events_metadata_safe CHECK (
    jsonb_typeof(metadata) = 'object'
    AND NOT metadata ?| ARRAY[
      'password',
      'password_hash',
      'token',
      'secret',
      'session_token',
      'api_key',
      'apiKey'
    ]
  ),
  CONSTRAINT auth_events_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX auth_events_user_id_created_at_idx
  ON auth_events (user_id, created_at DESC);

CREATE INDEX auth_events_type_created_at_idx
  ON auth_events (event_type, created_at DESC);

COMMENT ON TABLE auth_events IS
  'Authentication security events. Do not store passwords or raw tokens.';
