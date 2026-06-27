-- Migration: test_runs
-- Phase 2: structured results of sandbox test executions, per run.

-- Up Migration
CREATE TABLE test_runs (
  id             bigserial PRIMARY KEY,
  run_id         bigint NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  status         text NOT NULL,
  exit_code      integer,
  duration_ms    integer NOT NULL,
  command        text NOT NULL,
  failure_stage  text,
  output_tail    text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX test_runs_run_id_idx ON test_runs (run_id);

-- Down Migration
DROP TABLE test_runs;
