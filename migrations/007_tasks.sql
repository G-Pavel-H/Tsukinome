-- Migration: tasks
-- Phase 8: the decomposed implementation tasks for a run. One row per task, ordered by
-- idx. Records the TDD observations (red before, green after) and the per-task commit, so
-- the loop is restartable (done tasks are skipped on a retry).

-- Up Migration
CREATE TABLE tasks (
  id                  bigserial PRIMARY KEY,
  run_id              bigint NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  idx                 integer NOT NULL,
  title               text NOT NULL,
  description         text NOT NULL,
  acceptance_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  status              text NOT NULL DEFAULT 'pending',
  red_observed        boolean NOT NULL DEFAULT false,
  green_observed      boolean NOT NULL DEFAULT false,
  commit_sha          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, idx)
);

CREATE INDEX tasks_run_id_idx ON tasks (run_id);

-- Down Migration
DROP TABLE tasks;
