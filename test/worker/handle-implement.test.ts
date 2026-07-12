import { describe, it, expect, beforeEach } from 'vitest';
import {
  handleImplement,
  handleResumeImplementation,
  type ImplementHandlerDeps,
} from '../../src/worker/handlers.js';
import { SONNET_ATTEMPTS, OPUS_ATTEMPTS } from '../../src/pipeline/tdd.js';
import { IMPL_HELP_CAP } from '../../src/pipeline/implement.js';
import { LlmGateway } from '../../src/llm/gateway.js';
import { InMemoryStore } from '../../src/store/memory-store.js';
import { RunState, type Job } from '../../src/store/types.js';
import type { Plan } from '../../src/pipeline/schemas.js';
import { FakeLlmProvider, textResponse } from '../llm/fake-provider.js';
import { FakeSandboxProvider } from '../sandbox/fake-sandbox.js';
import { FakeCodeSandbox } from '../sandbox/fake-code-sandbox.js';
import { fakeGitHub, fakeOpenSandbox, silentLog } from '../helpers.js';
import type { TestRunStatus } from '../../src/sandbox/types.js';

const job: Job = {
  id: 30,
  type: 'implement',
  status: 'in_progress',
  attempts: 1,
  payload: { installationId: 7, owner: 'acme', repo: 'widgets', issueNumber: 42 },
};

const planData: Plan = {
  summary: 's',
  approach: 'a',
  affectedFiles: [{ path: 'src/add.ts', change: 'add', reason: 'r' }],
  contracts: [],
  dataChanges: [],
  testStrategy: ['t'],
};

const files = (path: string, content: string) => JSON.stringify({ files: [{ path, content }] });
const taskList = (...titles: string[]) =>
  JSON.stringify({
    tasks: titles.map((title, i) => ({
      id: `T${i + 1}`,
      title,
      description: `do ${title}`,
      acceptanceCriteria: [`${title} works`],
    })),
  });

async function seedImplementingRun(store: InMemoryStore): Promise<number> {
  const { run } = await store.findOrCreateRun(job.payload, RunState.Received);
  await store.updateRunState(run.id, RunState.Implementing);
  await store.updateRunContext(run.id, { planData });
  await store.recordArtifact({ runId: run.id, kind: 'spec', path: '.tsukinome/42/spec.md', content: '# spec' });
  await store.recordArtifact({ runId: run.id, kind: 'plan', path: '.tsukinome/42/plan.md', content: '# plan' });
  return run.id;
}

function deps(
  store: InMemoryStore,
  provider: FakeLlmProvider,
  sandbox: FakeCodeSandbox,
): ImplementHandlerDeps & { github: ReturnType<typeof fakeGitHub> } {
  const github = fakeGitHub({ language: 'TypeScript' });
  return {
    store,
    github,
    gateway: new LlmGateway(provider, store, silentLog),
    sandboxProvider: new FakeSandboxProvider(),
    openSandbox: fakeOpenSandbox(sandbox).fn,
    log: silentLog,
  };
}

describe('handleImplement', () => {
  let store: InMemoryStore;
  beforeEach(() => {
    store = new InMemoryStore();
  });

  it('decomposes, implements each task test-first, commits per task, and advances to review', async () => {
    const runId = await seedImplementingRun(store);
    // decompose → 2 tasks; per task: test-author, implementer, refactor.
    const provider = new FakeLlmProvider([
      textResponse(taskList('add', 'multiply')),
      textResponse(files('src/add.test.ts', 't1')),
      textResponse(files('src/add.ts', 'i1')),
      textResponse(files('src/add.ts', 'r1')),
      textResponse(files('src/mul.test.ts', 't2')),
      textResponse(files('src/mul.ts', 'i2')),
      textResponse(files('src/mul.ts', 'r2')),
    ]);
    // per task: failed (red) → passed (green) → passed (refactor)
    const sandbox = new FakeCodeSandbox(
      ['failed', 'passed', 'passed', 'failed', 'passed', 'passed'] as TestRunStatus[],
    );
    const d = deps(store, provider, sandbox);

    await handleImplement(job, d);

    const tasks = await store.getTasks(runId);
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.status === 'done' && t.redObserved && t.greenObserved)).toBe(true);
    expect(tasks.every((t) => t.commitSha)).toBe(true);
    expect(d.github.commitFiles).toHaveBeenCalledTimes(2); // one commit per task
    expect((await store.getRunById(runId))!.state).toBe(RunState.Reviewing);
    expect(sandbox.closed).toBe(1); // sandbox torn down
    // Review is chained.
    const next = await store.claimNextJob();
    expect(next!.type).toBe('review');
  });

  const implAttempts = SONNET_ATTEMPTS + OPUS_ATTEMPTS;
  const stalledScripts = () => {
    const provider = new FakeLlmProvider([
      textResponse(taskList('add')),
      textResponse(files('src/add.test.ts', 't')), // test-author → red
      // one implementer response per ladder rung (all fail)
      ...Array.from({ length: implAttempts }, (_, i) => textResponse(files('src/add.ts', `i${i + 1}`))),
    ]);
    const sandbox = new FakeCodeSandbox([
      'failed',
      ...(Array(implAttempts).fill('failed') as TestRunStatus[]),
    ]);
    return { provider, sandbox };
  };

  it('parks at the human-help gate (not Failed) when a task cannot be completed, instead of looping', async () => {
    const runId = await seedImplementingRun(store);
    const { provider, sandbox } = stalledScripts();
    const d = deps(store, provider, sandbox);

    await handleImplement(job, d);

    const run = (await store.getRunById(runId))!;
    expect(run.state).toBe(RunState.AwaitingImplHelp); // paused for guidance, not dead-ended
    expect(d.github.postIssueComment).toHaveBeenCalled();
    expect(d.github.commitFiles).not.toHaveBeenCalled();
    expect((await store.getTasks(runId))[0]!.status).toBe('escalated');
    // The gate remembers where it stalled so a reply can resume it.
    const implHelp = run.context.implHelp as { taskId: number; rounds: number } | undefined;
    expect(implHelp?.taskId).toBe((await store.getTasks(runId))[0]!.id);
    expect(implHelp?.rounds).toBe(0);
    expect(sandbox.closed).toBe(1);
  });

  const resumeJob = (commentBody: string): Job => ({
    id: 31,
    type: 'resume_implementation',
    status: 'in_progress',
    attempts: 1,
    payload: { installationId: 7, owner: 'acme', repo: 'widgets', issueNumber: 42, commentBody },
  });

  it('resumes with human guidance and lands the task green', async () => {
    const runId = await seedImplementingRun(store);
    // First pass stalls → parks at the gate.
    const first = stalledScripts();
    await handleImplement(job, deps(store, first.provider, first.sandbox));
    expect((await store.getRunById(runId))!.state).toBe(RunState.AwaitingImplHelp);

    // Human replies with guidance → enqueues a fresh implement job.
    const resumeDeps = deps(store, new FakeLlmProvider(), new FakeCodeSandbox());
    await handleResumeImplementation(resumeJob('drop the bogus AC and try again'), resumeDeps);
    const run = (await store.getRunById(runId))!;
    expect(run.state).toBe(RunState.Implementing);
    expect((run.context.implHelp as { rounds: number }).rounds).toBe(1);
    const queued = await store.claimNextJob();
    expect(queued!.type).toBe('implement');

    // The retried implement run greens the task (test-author red → impl green → refactor).
    const retry = new FakeLlmProvider([
      textResponse(files('src/add.test.ts', 't')),
      textResponse(files('src/add.ts', 'good-impl')),
      textResponse(files('src/add.ts', 'tidy')),
    ]);
    const retrySandbox = new FakeCodeSandbox(['failed', 'passed', 'passed'] as TestRunStatus[]);
    const retryDeps = deps(store, retry, retrySandbox);
    await handleImplement(job, retryDeps);

    const done = (await store.getRunById(runId))!;
    expect(done.state).toBe(RunState.Reviewing);
    expect((await store.getTasks(runId))[0]!.status).toBe('done');
    expect(done.context.implHelp).toBeUndefined(); // gate state cleared once it landed
    // The guidance reached the agents.
    expect(JSON.stringify(retry.requests)).toContain('drop the bogus AC and try again');
  });

  it('aborts the run when the human replies /abort at the gate', async () => {
    const runId = await seedImplementingRun(store);
    const first = stalledScripts();
    await handleImplement(job, deps(store, first.provider, first.sandbox));

    await handleResumeImplementation(resumeJob('/abort'), deps(store, new FakeLlmProvider(), new FakeCodeSandbox()));

    expect((await store.getRunById(runId))!.state).toBe(RunState.Aborted);
    expect(await store.claimNextJob()).toBeNull(); // no retry enqueued
  });

  it('fails for real once the guided-retry cap is exceeded', async () => {
    const runId = await seedImplementingRun(store);
    // Seed a run already parked at the gate with the cap already consumed.
    await store.updateRunState(runId, RunState.AwaitingImplHelp);
    await store.updateRunContext(runId, {
      planData,
      implHelp: { taskId: 1, stage: 'impl', rounds: IMPL_HELP_CAP },
    });

    await handleResumeImplementation(
      resumeJob('one more try'),
      deps(store, new FakeLlmProvider(), new FakeCodeSandbox()),
    );

    expect((await store.getRunById(runId))!.state).toBe(RunState.Failed);
    expect(await store.claimNextJob()).toBeNull(); // no further retry
  });

  it('stops at a task boundary when the budget is exhausted', async () => {
    const runId = await seedImplementingRun(store);
    await store.setRunBudget(runId, 1); // decompose call will exhaust it
    const provider = new FakeLlmProvider([textResponse(taskList('add'), { inputTokens: 10, outputTokens: 5 })]);
    const sandbox = new FakeCodeSandbox(['failed', 'passed', 'passed'] as TestRunStatus[]);
    const d = deps(store, provider, sandbox);

    await handleImplement(job, d);

    // Budget exhausts during/after decompose → graceful Failed at the first boundary.
    expect((await store.getRunById(runId))!.state).toBe(RunState.Failed);
    expect(d.github.commitFiles).not.toHaveBeenCalled();
    expect(sandbox.closed).toBe(1);
  });

  it('is idempotent — skips when the run is not Implementing', async () => {
    const { run } = await store.findOrCreateRun(job.payload, RunState.Received);
    await store.updateRunState(run.id, RunState.Reviewing);
    const provider = new FakeLlmProvider();
    const sandbox = new FakeCodeSandbox();
    const d = deps(store, provider, sandbox);

    await handleImplement(job, d);

    expect(provider.requests).toHaveLength(0);
    expect(sandbox.closed).toBe(0); // never opened
  });
});
