-- Rights are separate from catalog publication and from provider health.
-- A movie can stay public while its media is not authorized for download.

ALTER TABLE media_references
  ADD COLUMN rights_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW';

ALTER TABLE media_references
  ADD CONSTRAINT media_references_rights_status_check CHECK (
    rights_status IN ('AUTHORIZED', 'PENDING_REVIEW', 'UNAVAILABLE', 'REMOVED')
  );

UPDATE media_references
SET rights_status = 'AUTHORIZED'
WHERE status = 'available'
  AND availability_status = 'available';

CREATE INDEX media_references_rights_status_idx
  ON media_references (movie_id, rights_status);

CREATE TABLE content_complaints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_code TEXT NOT NULL,
  movie_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  summary TEXT NOT NULL,
  contact TEXT NOT NULL,
  action_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_by UUID,
  CONSTRAINT content_complaints_case_code_key UNIQUE (case_code),
  CONSTRAINT content_complaints_status_check CHECK (
    status IN ('RECEIVED', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'REMOVED', 'REJECTED', 'RESOLVED')
  ),
  CONSTRAINT content_complaints_summary_check CHECK (char_length(summary) BETWEEN 8 AND 500),
  CONSTRAINT content_complaints_contact_check CHECK (char_length(contact) BETWEEN 3 AND 200),
  CONSTRAINT content_complaints_movie_id_fkey
    FOREIGN KEY (movie_id) REFERENCES movies (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT content_complaints_resolved_by_fkey
    FOREIGN KEY (resolved_by) REFERENCES users (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX content_complaints_status_idx
  ON content_complaints (status, created_at DESC);

COMMENT ON TABLE content_complaints IS
  'Rights complaints. Contact is for administrators only and is not a public field.';
