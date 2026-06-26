import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { Pool } from 'pg';
import { createPool } from '../../src/db/pool.js';
import { PgStore } from '../../src/store/pg-store.js';
import { RunState, type RunKey } from '../../src/store/types.js';

const DATABASE_URL = process.env.DATABASE_URL;

const payload = {
  installationId: 1,
  owner: 'acme',
  repo: 'widgets',
  issueNumber: 42,
  deliveryId: 'd-1',
};

const key: RunKey = {
  installationId: 1,
  owner: 'acme',
  repo: 'widgets',
  issueNumber: 42,
};

// Integration test against a real Postgres. Skipped locally when DATABASE_URL is
// unset; runs in CI against the service container (after `npm run migrate up`).
describe.skipIf(!DATABASE_URL)('PgStore (integration)', () => {
  let pool: Pool;
  let store: PgStore;

  beforeAll(() => {
    pool = createPool(DATABASE_URL!);
    store = new PgStore(pool);
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE jobs, runs, processed_events RESTART IDENTITY');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('enqueues, claims, and completes a job', async () => {
    const job = await store.enqueueJob({ type: 'issue_opened', payload });
    expect(job.status).toBe('queued');

    const claimed = await store.claimNextJob();
    expect(claimed!.id).toBe(job.id);
    expect(claimed!.status).toBe('in_progress');
    expect(claimed!.payload).toEqual(payload);

    await store.markJobDone(job.id);
    expect(await store.claimNextJob()).toBeNull();
  });

  it('hands distinct jobs to concurrent claimers (FOR UPDATE SKIP LOCKED)', async () => {
    const a = await store.enqueueJob({ type: 'issue_opened', payload });
    const b = await store.enqueueJob({ type: 'issue_opened', payload });

    const [first, second] = await Promise.all([store.claimNextJob(), store.claimNextJob()]);
    const ids = [first!.id, second!.id].sort((x, y) => x - y);
    expect(ids).toEqual([a.id, b.id].sort((x, y) => x - y));
  });

  it('creates a run once per issue (unique key)', async () => {
    const first = await store.findOrCreateRun(key, RunState.Received);
    expect(first.created).toBe(true);

    const second = await store.findOrCreateRun(key, RunState.Received);
    expect(second.created).toBe(false);
    expect(second.run.id).toBe(first.run.id);

    await store.updateRunState(first.run.id, RunState.Acknowledged);
    expect((await store.getRun(key))!.state).toBe(RunState.Acknowledged);
  });

  it('dedupes processed events by delivery id', async () => {
    expect(await store.tryMarkEventProcessed('x-1')).toBe(true);
    expect(await store.tryMarkEventProcessed('x-1')).toBe(false);
  });
});
