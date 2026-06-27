import { describe, it, expect, beforeEach } from 'vitest';
import { runTaskTdd, decompose, SONNET_ATTEMPTS, OPUS_ATTEMPTS, type TddContext } from '../../src/pipeline/tdd.js';
import { LlmGateway } from '../../src/llm/gateway.js';
import { InMemoryStore } from '../../src/store/memory-store.js';
import { RunState, type RunKey } from '../../src/store/types.js';
import { FakeLlmProvider, textResponse } from '../llm/fake-provider.js';
import { FakeCodeSandbox } from '../sandbox/fake-code-sandbox.js';
import { silentLog } from '../helpers.js';
import type { TestRunStatus } from '../../src/sandbox/types.js';

const key: RunKey = { installationId: 1, owner: 'acme', repo: 'widgets', issueNumber: 1 };

const task = {
  id: 'T1',
  title: 'add',
  description: 'implement add',
  acceptanceCriteria: ['adds two numbers'],
};

const files = (path: string, content: string) => JSON.stringify({ files: [{ path, content }] });

async function ctx(
  store: InMemoryStore,
  provider: FakeLlmProvider,
  sandbox: FakeCodeSandbox,
): Promise<TddContext> {
  const { run } = await store.findOrCreateRun(key, RunState.Received);
  return {
    sandbox,
    gateway: new LlmGateway(provider, store, silentLog),
    runId: run.id,
    log: silentLog,
    specMarkdown: '# spec',
    planMarkdown: '# plan',
    affectedPaths: ['src/add.ts', 'src/add.test.ts'],
  };
}

describe('runTaskTdd', () => {
  let store: InMemoryStore;
  beforeEach(() => {
    store = new InMemoryStore();
  });

  it('drives a task red → green → refactor and reports it done', async () => {
    const provider = new FakeLlmProvider([
      textResponse(files('src/add.test.ts', 'test')), // test-author
      textResponse(files('src/add.ts', 'impl')), // implementer
      textResponse(files('src/add.ts', 'impl tidy')), // refactor
    ]);
    // tests fail after author, pass after impl, pass after refactor
    const sandbox = new FakeCodeSandbox(['failed', 'passed', 'passed']);

    const outcome = await runTaskTdd(task, await ctx(store, provider, sandbox));

    expect(outcome.status).toBe('done');
    expect(outcome.redObserved).toBe(true);
    expect(outcome.greenObserved).toBe(true);
    expect(outcome.changedPaths.sort()).toEqual(['src/add.test.ts', 'src/add.ts']);
  });

  it('rejects a task whose tests pass before implementation (TDD ordering enforced)', async () => {
    const provider = new FakeLlmProvider();
    // Every test-author attempt yields tests; sandbox says they pass → TDD violation each time.
    provider.always = textResponse(files('src/add.test.ts', 'test'));
    const sandbox = new FakeCodeSandbox(Array(SONNET_ATTEMPTS + OPUS_ATTEMPTS).fill('passed') as TestRunStatus[]);

    const outcome = await runTaskTdd(task, await ctx(store, provider, sandbox));

    expect(outcome.status).toBe('escalated');
    expect(outcome.stage).toBe('test');
    expect(outcome.redObserved).toBe(false);
  });

  it('escalates (no infinite loop) when the implementation never goes green', async () => {
    const provider = new FakeLlmProvider();
    provider.always = textResponse(files('src/add.ts', 'impl')); // also serves the test-author
    // test-author: red once; then implementer attempts all fail.
    const sandbox = new FakeCodeSandbox(['failed', 'failed', 'failed', 'failed']);

    const outcome = await runTaskTdd(task, await ctx(store, provider, sandbox));

    expect(outcome.status).toBe('escalated');
    expect(outcome.stage).toBe('impl');
    expect(outcome.redObserved).toBe(true);
  });

  it('promotes Sonnet → Opus on the escalation ladder before giving up', async () => {
    const provider = new FakeLlmProvider();
    provider.always = textResponse(files('src/add.test.ts', 'test'));
    const sandbox = new FakeCodeSandbox(Array(SONNET_ATTEMPTS + OPUS_ATTEMPTS).fill('passed') as TestRunStatus[]);

    await runTaskTdd(task, await ctx(store, provider, sandbox));

    const models = provider.requests.map((r) => r.model);
    expect(models.slice(0, SONNET_ATTEMPTS).every((m) => m === 'claude-sonnet-4-6')).toBe(true);
    expect(models).toContain('claude-opus-4-8'); // promoted after the Sonnet attempts
  });
});

describe('decompose', () => {
  it('returns the decomposer agent tasks', async () => {
    const store = new InMemoryStore();
    const { run } = await store.findOrCreateRun(key, RunState.Received);
    const provider = new FakeLlmProvider([
      textResponse(JSON.stringify({ tasks: [task, { ...task, id: 'T2', title: 'multiply' }] })),
    ]);
    const tasks = await decompose('# spec', '# plan', {
      runId: run.id,
      gateway: new LlmGateway(provider, store, silentLog),
      log: silentLog,
    });
    expect(tasks.map((t) => t.id)).toEqual(['T1', 'T2']);
  });
});
