import { describe, it, expect, beforeEach } from 'vitest';
import { processNextJob } from '../../src/worker/worker.js';
import { InMemoryStore } from '../../src/store/memory-store.js';
import { fakeGitHub, silentLog } from '../helpers.js';

const payload = {
  installationId: 7,
  owner: 'acme',
  repo: 'widgets',
  issueNumber: 42,
  deliveryId: 'd-1',
};

describe('processNextJob', () => {
  let store: InMemoryStore;
  beforeEach(() => {
    store = new InMemoryStore();
  });

  it('returns false when there is no job to process', async () => {
    const github = fakeGitHub();
    expect(await processNextJob({ store, github, log: silentLog })).toBe(false);
  });

  it('claims a queued job, runs its handler, and marks it done', async () => {
    const github = fakeGitHub();
    await store.enqueueJob({ type: 'issue_opened', payload });

    const processed = await processNextJob({ store, github, log: silentLog });
    expect(processed).toBe(true);
    expect(github.postIssueComment).toHaveBeenCalledTimes(1);

    // No queued jobs remain.
    expect(await store.claimNextJob()).toBeNull();
  });

  it('marks the job failed when its handler throws, without crashing', async () => {
    const github = fakeGitHub({ fail: true });
    const job = await store.enqueueJob({ type: 'issue_opened', payload });

    const processed = await processNextJob({ store, github, log: silentLog });
    expect(processed).toBe(true);
    expect(store.getJob(job.id)!.status).toBe('failed');
  });
});
