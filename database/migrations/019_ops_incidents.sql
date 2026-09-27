-- Operational incidents. No personal data and no provider credentials.

CREATE TABLE ops_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_code TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DETECTED',
  service TEXT NOT NULL,
  summary TEXT NOT NULL,
  detection_code TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  opened_by UUID,
  updated_by UUID,
  impact TEXT,
  cause TEXT,
  mitigation TEXT,
  prevention TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ops_incidents_case_code_unique UNIQUE (case_code),
  CONSTRAINT ops_incidents_case_code_check CHECK (case_code ~ '^IN[0-9A-F]{8}$'),
  CONSTRAINT ops_incidents_severity_check CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM')),
  CONSTRAINT ops_incidents_status_check CHECK (
    status IN ('DETECTED', 'INVESTIGATING', 'MITIGATING', 'RESOLVED', 'POSTMORTEM')
  ),
  CONSTRAINT ops_incidents_service_check CHECK (
    service IN (
      'APPLICATION', 'DATABASE', 'CACHE', 'QUEUE', 'WORKERS', 'SEARCH',
      'MEDIA PROVIDERS', 'CDN', 'PWA', 'BACKUPS', 'DOWNLOADS', 'SECURITY'
    )
  ),
  CONSTRAINT ops_incidents_summary_check CHECK (char_length(summary) BETWEEN 8 AND 300),
  CONSTRAINT ops_incidents_opened_by_fkey
    FOREIGN KEY (opened_by) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ops_incidents_updated_by_fkey
    FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX ops_incidents_open_idx ON ops_incidents (status, started_at DESC);

CREATE TABLE ops_incident_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL,
  actor_id UUID,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ops_incident_notes_body_check CHECK (char_length(body) BETWEEN 2 AND 500),
  CONSTRAINT ops_incident_notes_incident_id_fkey
    FOREIGN KEY (incident_id) REFERENCES ops_incidents (id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ops_incident_notes_actor_id_fkey
    FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE RESTRICT
);

COMMENT ON TABLE ops_incidents IS
  'Internal incident records. Do not store passwords, tokens, or visitor identifiers.';
