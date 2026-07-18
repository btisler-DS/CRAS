CREATE TABLE execution_records (
  execution_id TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL UNIQUE,
  action_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('AUTHORIZED', 'DISPATCHED', 'EXECUTED', 'ADAPTER_FAILED')
  ),
  consumed_at TEXT NOT NULL,
  dispatched_at TEXT,
  executed_at TEXT,
  adapter_error TEXT,
  adapter_call_count INTEGER NOT NULL DEFAULT 0,
  final_position TEXT,
  FOREIGN KEY (grant_id)
    REFERENCES authorization_grants (grant_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX execution_records_action_id_idx
  ON execution_records (action_id);
