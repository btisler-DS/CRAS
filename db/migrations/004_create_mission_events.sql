CREATE TABLE mission_events (
  mission_event_id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  correlation_id TEXT NOT NULL,
  action_id TEXT,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (
    actor IN ('OPERATOR', 'ROBOT', 'CRAS', 'EVIDENCE_STORE', 'DISPATCHER', 'ADAPTER')
  ),
  detail TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  evidence_record_id TEXT,
  grant_id TEXT,
  UNIQUE (mission_id, sequence),
  FOREIGN KEY (evidence_record_id)
    REFERENCES evidence_records (evidence_record_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  FOREIGN KEY (grant_id)
    REFERENCES authorization_grants (grant_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX mission_events_correlation_id_idx
  ON mission_events (correlation_id);

CREATE INDEX mission_events_action_id_idx
  ON mission_events (action_id);
