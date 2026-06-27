import { describe, it, expect, beforeEach } from 'vitest';
import { handleResumePlanDecision, type PlanHandlerDeps } from '../../src/worker/handlers.js';
import { LlmGateway } from '../../src/llm/gateway.js';
import { InMemoryStore } from '../../src/store/memory-store.js';
import { RunState, type Job } from '../../src/store/types.js';
import type { Spec } from '../../src/pipeline/schemas.js';
import { PLAN_REVISION_CAP } from '../../src/pipeline/plan.js';
import { FakeLlmProvider, textResponse } from '../llm/fake-provider.js';
import { fakeCodeIndex, fakeCloneRepo, fakeGitHub, silentLog } from '../helpers.js';

function jobWith(commentBody: string): Job {
  return {
    id: 22,
    type: 'resume_plan_decision',
    status: 'in_progress',
    attempts: 1,
    payload: { installationId: 7, owner: 'acme', repo: 'widgets', issueNumber: 42, commentBody },
  };
}

const key = { installationId: 7, owner: 'acme', repo: 'widgets', issueNumber: 42 };

const specData: Spec = {
  summary: 'Add a JSON export.',
  requirements: [{ id: 'R1', statement: 'Export is JSON.', confidence: 'explicit' }],
  acceptanceCriteria: [{ id: 'AC1', given: 'data', when: 'export', then: 'json' }],
  nonGoals: ['CSV'],
  edgeCases: [],
  assumptions: [],
  openQuestions: [],
};

const planJson = JSON.stringify({
  summary: 'Revised exporter.',
  approach: 'Stream the writer.',
  affectedFiles: [{ path: 'src/export.ts', change: 'add', reason: 'exporter' }],
  contracts: [],
  dataChanges: [],
  testStrategy: ['unit test for AC1'],
});

async function seedParkedRun(store: InMemoryStore, revisions?: number): Promise<number> {
  const { run } = await store.findOrCreateRun(key, RunState.Received);
  await store.updateRunState(run.id, RunState.AwaitingPlanApproval);
  await store.updateRunContext(run.id, {
    spec: { title: 'JSON export' },
    specData,
    ...(revisions !== undefined ? { plan: { revisions } } : {}),
  });
  await store.recordArtifact({ runId: run.id, kind: 'spec', path: '.tsukinome/42/spec.md', content: '# Spec' });
  await store.recordArtifact({ runId: run.id, kind: 'plan', path: '.tsukinome/42/plan.md', content: '# Plan v1' });
  return run.id;
}

function deps(store: InMemoryStore, provider: FakeLlmProvider): PlanHandlerDeps {
  return {
    store,
    github: fakeGitHub({ language: 'TypeScript' }),
    gateway: new LlmGateway(provider, store, silentLog),
    codeIndex: fakeCodeIndex(),
    cloneRepo: fakeCloneRepo().fn,
    log: silentLog,
  };
}

describe('handleResumePlanDecision', () => {
  let store: InMemoryStore;
  beforeEach(() => {
    store = new InMemoryStore();
  });

  it('/approve advances to implementation without running the architect', async () => {
    const runId = await seedParkedRun(store);
    const provider = new FakeLlmProvider();
    const d = deps(store, provider);

    await handleResumePlanDecision(jobWith('lgtm /approve'), d);

    expect(provider.requests).toHaveLength(0);
    expect((await store.getRunById(runId))!.state).toBe(RunState.Implementing);
  });

  it('/abort closes the run cleanly', async () => {
    const runId = await seedParkedRun(store);
    const d = deps(store, new FakeLlmProvider());

    await handleResumePlanDecision(jobWith('/abort'), d);

    expect((await store.getRunById(runId))!.state).toBe(RunState.Aborted);
  });

  it('a change request regenerates the plan and re-parks', async () => {
    const runId = await seedParkedRun(store);
    const provider = new FakeLlmProvider([textResponse(planJson, { inputTokens: 500, outputTokens: 200 })]);
    const d = deps(store, provider);

    await handleResumePlanDecision(jobWith('please stream the writer instead'), d);

    expect(provider.requests).toHaveLength(1); // architect re-ran
    const commit = (d.github as ReturnType<typeof fakeGitHub>).commitFile.mock.calls[0]![0];
    expect(commit.path).toBe('.tsukinome/42/plan.md');
    const run = await store.getRunById(runId);
    expect(run!.state).toBe(RunState.AwaitingPlanApproval);
    expect((run!.context.plan as { revisions: number }).revisions).toBe(1);
  });

  it('stops auto-revising once the revision cap is reached', async () => {
    const runId = await seedParkedRun(store, PLAN_REVISION_CAP);
    const provider = new FakeLlmProvider();
    const d = deps(store, provider);

    await handleResumePlanDecision(jobWith('one more change please'), d);

    expect(provider.requests).toHaveLength(0); // no regenerate
    expect((d.github as ReturnType<typeof fakeGitHub>).postIssueComment).toHaveBeenCalled();
    expect((await store.getRunById(runId))!.state).toBe(RunState.AwaitingPlanApproval);
  });

  it('is idempotent — skips when the run is not at the plan gate', async () => {
    const { run } = await store.findOrCreateRun(key, RunState.Received);
    await store.updateRunState(run.id, RunState.Implementing);
    const provider = new FakeLlmProvider();
    const d = deps(store, provider);

    await handleResumePlanDecision(jobWith('/abort'), d);

    expect(provider.requests).toHaveLength(0);
    expect((await store.getRunById(run.id))!.state).toBe(RunState.Implementing);
  });
});
