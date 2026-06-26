-- Migration: phase1_core
-- Phase 1 schema: job queue, run state, and webhook dedupe.

-- Up Migration
CREATE TABLE jobs (
  id          bigserial PRIMARY KEY,
  type        text NOT NULL,
  payload     jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'queued',
  attempts    integer NOT NULL DEFAULT 0,
  last_error  text,
  locked_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Supports the FOR UPDATE SKIP LOCKED claim query.
CREATE INDEX jobs_status_id_idx ON jobs (status, id);

CREATE TABLE runs (
  id               bigserial PRIMARY KEY,
  installation_id  bigint NOT NULL,
  owner            text NOT NULL,
  repo             text NOT NULL,
  issue_number     integer NOT NULL,
  state            text NOT NULL,
  context          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (installation_id, owner, repo, issue_number)
);

CREATE TABLE processed_events (
  delivery_id   text PRIMARY KEY,
  processed_at  timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
DROP TABLE processed_events;
DROP TABLE runs;
DROP TABLE jobs;
