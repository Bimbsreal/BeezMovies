-- Resolution timing only. No addresses, tokens, or file bytes.

ALTER TABLE download_events
  ADD COLUMN duration_ms INTEGER;

ALTER TABLE download_events
  ADD CONSTRAINT download_events_duration_check CHECK (
    duration_ms IS NULL OR duration_ms >= 0
  );
