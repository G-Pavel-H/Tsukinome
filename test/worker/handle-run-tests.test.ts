import { describe, it, expect, beforeEach } from 'vitest';
import { handleRunTests } from '../../src/worker/handlers.js';
import { InMemoryStore } from '../../src/store/memory-store.js';
import { type Job } from '../../src/store/types.js';
import { FakeSandboxProvider } from '../sandbox/fake-sandbox.js';
import { fakeGitHub, silentLog } from '../helpers.js';

const job: Job = {
  id: 5,
  type: 'run_tests',
  status: 'in_progress',
  attempts: 1,
  payload: {
    installationId: 7,
    owner: 'acme',
    repo: 'widgets',
    ref: 'main',
    issueNumber: 42,
  },
};

describe('handleRunTests', () => {
  let store: InMemoryStore;
  beforeEach(() => {
    store = new InMemoryStore();
  });

  it('mints a least-privilege token, runs tests in a sandbox, and records the result', async () => {
    const github = fakeGitHub();
    const sandboxProvider = new FakeSandboxProvider();

    await handleRunTests(job, { store, github, sandboxProvider, log: silentLog });

    expect(github.getInstallationToken).toHaveBeenCalledWith({
      installationId: 7,
      owner: 'acme',
      repo: 'widgets',
    });

    // Sandbox was created and torn down.
    expect(sandboxProvider.only.killed).toBe(1);

    // Structured result persisted against the run.
    const run = await store.getRun(job.payload);
    const testRuns = await store.getTestRuns(run!.id);
    expect(testRuns).toHaveLength(1);
    expect(testRuns[0]!.status).toBe('passed');
    expect(testRuns[0]!.command).toBe('npm test');
  });

  it('records a failed result without throwing when the suite fails', async () => {
    const github = fakeGitHub();
    const sandboxProvider = new FakeSandboxProvider([
      { match: 'npm test', result: { exitCode: 1, stdout: 'boom', stderr: '' } },
    ]);

    await handleRunTests(job, { store, github, sandboxProvider, log: silentLog });

    const run = await store.getRun(job.payload);
    const testRuns = await store.getTestRuns(run!.id);
    expect(testRuns[0]!.status).toBe('failed');
    expect(sandboxProvider.only.killed).toBe(1);
  });
});
