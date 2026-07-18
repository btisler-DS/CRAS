CREATE TABLE authorization_grants (
  grant_id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  evidence_record_id TEXT NOT NULL UNIQUE,
  action_digest TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('AUTHORIZED', 'CONSUMED', 'REVOKED')),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (evidence_record_id, action_id, action_digest)
    REFERENCES evidence_records (
      evidence_record_id,
      action_id,
      action_digest
    )
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX authorization_grants_action_id_idx
  ON authorization_grants (action_id);
