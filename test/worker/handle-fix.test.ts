import { describe, it, expect, beforeEach } from 'vitest';
import { handleFix, type ImplementHandlerDeps } from '../../src/worker/handlers.js';
import { LlmGateway } from '../../src/llm/gateway.js';
import { InMemoryStore } from '../../src/store/memory-store.js';
import { RunState, type Job } from '../../src/store/types.js';
import { FIX_ROUND_CAP } from '../../src/pipeline/fix.js';
import { FakeLlmProvider, textResponse } from '../llm/fake-provider.js';
import { FakeSandboxProvider } from '../sandbox/fake-sandbox.js';
import { FakeCodeSandbox } from '../sandbox/fake-code-sandbox.js';
import { fakeGitHub, fakeOpenSandbox, silentLog } from '../helpers.js';
import type { TestRunStatus } from '../../src/sandbox/types.js';

function fixJob(overrides: Record<string, unknown> = {}): Job {
  return {
    id: 50,
    type: 'fix',
    status: 'in_progress',
    attempts: 1,
    payload: {
      installationId: 7,
      owner: 'acme',
      repo: 'widgets',
      issueNumber: 42,
      prNumber: 7,
      commentBody: 'handle the empty input case',
      filePath: 'src/add.ts',
      reviewCommentId: 1001,
      ...overrides,
    },
  };
}

const triage = (kind: 'actionable' | 'vague' | 'rework') =>
  textResponse(JSON.stringify({ kind, reason: 'because' }));
const files = (path: string, content: string) => JSON.stringify({ files: [{ path, content }] });

async function seedParkedPr(store: InMemoryStore, fixRounds?: number): Promise<number> {
  const key = { installationId: 7, owner: 'acme', repo: 'widgets', issueNumber: 42 };
  const { run } = await store.findOrCreateRun(key, RunState.Received);
  await store.updateRunState(run.id, RunState.AwaitingPrReview);
  if (fixRounds !== undefined) await store.updateRunContext(run.id, { fix: { rounds: fixRounds } });
  await store.recordArtifact({ runId: run.id, kind: 'spec', path: '.tsukinome/42/spec.md', content: '# spec' });
  await store.recordArtifact({ runId: run.id, kind: 'plan', path: '.tsukinome/42/plan.md', content: '# plan' });
  return run.id;
}

function deps(
  store: InMemoryStore,
  provider: FakeLlmProvider,
  sandbox = new FakeCodeSandbox(),
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

describe('handleFix', () => {
  let store: InMemoryStore;
  beforeEach(() => {
    store = new InMemoryStore();
  });

  it('actionable → test-first fix commit + thread reply, round bumped, stays parked', async () => {
    const runId = await seedParkedPr(store);
    const provider = new FakeLlmProvider([
      triage('actionable'),
      textResponse(files('src/add.test.ts', 't')), // test-author → red
      textResponse(files('src/add.ts', 'i')), // implementer → green
      textResponse(files('src/add.ts', 'r')), // refactor
    ]);
    const sandbox = new FakeCodeSandbox(['failed', 'passed', 'passed'] as TestRunStatus[]);
    const d = deps(store, provider, sandbox);

    await handleFix(fixJob(), d);

    expect(d.github.commitFiles).toHaveBeenCalledTimes(1);
    expect(d.github.replyToReviewComment).toHaveBeenCalledTimes(1); // inline reply
    const run = await store.getRunById(runId);
    expect(run!.state).toBe(RunState.AwaitingPrReview); // stays parked for re-review
    expect((run!.context.fix as { rounds: number }).rounds).toBe(1);
    expect(sandbox.closed).toBe(1);
  });

  it('vague → one clarifying reply, no commit, no round consumed', async () => {
    const runId = await seedParkedPr(store);
    const provider = new FakeLlmProvider([triage('vague')]);
    const d = deps(store, provider);

    await handleFix(fixJob(), d);

    expect(d.github.replyToReviewComment).toHaveBeenCalledTimes(1);
    expect(d.github.commitFiles).not.toHaveBeenCalled();
    const run = await store.getRunById(runId);
    expect(run!.state).toBe(RunState.AwaitingPrReview);
    expect(run!.context.fix).toBeUndefined();
  });

  it('rework → reply + route back to the plan gate', async () => {
    const runId = await seedParkedPr(store);
    const provider = new FakeLlmProvider([triage('rework')]);
    const d = deps(store, provider);

    await handleFix(fixJob(), d);

    expect((await store.getRunById(runId))!.state).toBe(RunState.AwaitingPlanApproval);
    expect(d.github.commitFiles).not.toHaveBeenCalled();
    expect((await store.claimNextJob())!.type).toBe('resume_plan_decision');
  });

  it('escalates to a human when the fix-round cap is exceeded', async () => {
    const runId = await seedParkedPr(store, FIX_ROUND_CAP);
    const provider = new FakeLlmProvider([triage('actionable')]);
    const d = deps(store, provider);

    await handleFix(fixJob(), d);

    expect(d.github.commitFiles).not.toHaveBeenCalled();
    expect((await store.getRunById(runId))!.state).toBe(RunState.Failed);
    expect(d.github.replyToReviewComment).toHaveBeenCalled();
  });

  it('escalates when the TDD loop cannot land the fix', async () => {
    const runId = await seedParkedPr(store);
    const provider = new FakeLlmProvider([
      triage('actionable'),
      textResponse(files('src/add.test.ts', 't')),
      textResponse(files('src/add.ts', 'i1')),
      textResponse(files('src/add.ts', 'i2')),
      textResponse(files('src/add.ts', 'i3')),
    ]);
    const sandbox = new FakeCodeSandbox(['failed', 'failed', 'failed', 'failed'] as TestRunStatus[]);
    const d = deps(store, provider, sandbox);

    await handleFix(fixJob(), d);

    expect((await store.getRunById(runId))!.state).toBe(RunState.Failed);
    expect(d.github.commitFiles).not.toHaveBeenCalled();
    expect(sandbox.closed).toBe(1);
  });

  it('replies on the PR conversation when there is no inline thread', async () => {
    await seedParkedPr(store);
    const provider = new FakeLlmProvider([triage('vague')]);
    const d = deps(store, provider);

    await handleFix(fixJob({ reviewCommentId: undefined, filePath: undefined }), d);

    expect(d.github.replyToReviewComment).not.toHaveBeenCalled();
    expect(d.github.postIssueComment).toHaveBeenCalled(); // PR conversation
  });

  it('is idempotent — skips when the run is not awaiting PR review', async () => {
    const { run } = await store.findOrCreateRun(
      { installationId: 7, owner: 'acme', repo: 'widgets', issueNumber: 42 },
      RunState.Received,
    );
    await store.updateRunState(run.id, RunState.Done);
    const provider = new FakeLlmProvider();
    const d = deps(store, provider);

    await handleFix(fixJob(), d);

    expect(provider.requests).toHaveLength(0);
  });
});
