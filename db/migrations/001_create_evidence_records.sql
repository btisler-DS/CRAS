CREATE TABLE evidence_records (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  evidence_record_id TEXT NOT NULL UNIQUE,
  action_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  normalized_action TEXT NOT NULL,
  action_digest TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  condition_results TEXT NOT NULL,
  identity_references TEXT NOT NULL,
  decision_timestamp TEXT NOT NULL,
  previous_record_hash TEXT,
  current_record_hash TEXT NOT NULL UNIQUE,
  UNIQUE (evidence_record_id, action_id, action_digest)
);

CREATE INDEX evidence_records_action_id_idx
  ON evidence_records (action_id);
