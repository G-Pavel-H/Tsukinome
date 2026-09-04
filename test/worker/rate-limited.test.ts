import { describe, it, expect, beforeEach } from 'vitest';
import { processNextJob } from '../../src/worker/worker.js';
import { InMemoryStore } from '../../src/store/memory-store.js';
import { LlmGateway } from '../../src/llm/gateway.js';
import { SubscriptionRateLimitError } from '../../src/llm/agent-sdk-provider.js';
import { RunState } from '../../src/store/types.js';
import { FakeSandboxProvider } from '../sandbox/fake-sandbox.js';
import { fakeCodeIndex, fakeCloneRepo, fakeOpenSandbox, fakeGitHub, silentLog } from '../helpers.js';

const sandboxProvider = new FakeSandboxProvider();
const codeIndex = fakeCodeIndex();
const cloneRepo = fakeCloneRepo().fn;
const openSandbox = fakeOpenSandbox().fn;

const payload = { installationId: 7, owner: 'acme', repo: 'widgets', issueNumber: 42 };

/** A worker whose every model call reports the installation's Claude plan as exhausted. */
function depsThatHitTheLimit(store: InMemoryStore, resetsAt?: Date) {
  const gateway = new LlmGateway(
    async () => ({
      async createMessage() {
        throw new SubscriptionRateLimitError(resetsAt);
      },
    }),
    store,
    silentLog,
  );
  const github = fakeGitHub({ language: 'TypeScript' });
  return {
    github,
    deps: {
      store,
      github,
      sandboxProvider,
      gateway,
      codeIndex,
      cloneRepo,
      openSandbox,
      log: silentLog,
    },
  };
}

describe('processNextJob — subscription rate limit', () => {
  let store: InMemoryStore;
  beforeEach(() => {
    store = new InMemoryStore();
  });

  it('stops gracefully: explains the plan limit, fails the run, does not retry', async () => {
    const { github, deps } = depsThatHitTheLimit(store);
    const job = await store.enqueueJob({ type: 'produce_spec', payload });

    expect(await processNextJob(deps)).toBe(true);

    // Terminal, like a missing key — retrying inside the backoff window just re-hits the limit.
    expect(store.getJob(job.id)!.status).toBe('done');
    const run = await store.getRun(payload);
    expect(run!.state).toBe(RunState.Failed);

    const comment = github.postIssueComment.mock.calls.at(-1)![0];
    expect(comment.issueNumber).toBe(42);
    expect(comment.body.toLowerCase()).toContain('limit');
    // Nothing was billed, and the run is closed rather than stranded mid-state.
    expect(await store.getLlmCalls(run!.id)).toHaveLength(0);
  });

  it('tells the user when the plan resets, when the SDK reported a reset time', async () => {
    const resetsAt = new Date('2026-09-02T18:00:00Z');
    const { github, deps } = depsThatHitTheLimit(store, resetsAt);
    await store.enqueueJob({ type: 'produce_spec', payload });

    await processNextJob(deps);

    const comment = github.postIssueComment.mock.calls.at(-1)![0];
    expect(comment.body).toContain(resetsAt.toISOString());
  });
});
