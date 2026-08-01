import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { TYPESCRIPT_JAVASCRIPT } from '../../src/toolchain/toolchain.js';
import { handleProducePlan, type PlanHandlerDeps } from '../../src/worker/handlers.js';
import { LlmGateway } from '../../src/llm/gateway.js';
import { InMemoryStore } from '../../src/store/memory-store.js';
import { RunState, type Job } from '../../src/store/types.js';
import type { Spec } from '../../src/pipeline/schemas.js';
import { FakeLlmProvider, textResponse } from '../llm/fake-provider.js';
import { fakeCodeIndex, fakeCloneRepo, fakeGitHub, silentLog } from '../helpers.js';

const job: Job = {
  id: 21,
  type: 'produce_plan',
  status: 'in_progress',
  attempts: 1,
  payload: { installationId: 7, owner: 'acme', repo: 'widgets', issueNumber: 42 },
};

const cleanSpec: Spec = {
  summary: 'Add a JSON export.',
  requirements: [{ id: 'R1', statement: 'Export is JSON.', confidence: 'explicit' }],
  acceptanceCriteria: [
    { id: 'AC1', given: 'data', when: 'export', then: 'json produced' },
  ],
  nonGoals: ['CSV export'],
  edgeCases: [],
  assumptions: [],
  openQuestions: [],
};

const planJson = JSON.stringify({
  summary: 'Add an exporter module.',
  approach: 'Reuse the serializer.',
  affectedFiles: [{ path: 'src/export.ts', change: 'add', reason: 'new exporter' }],
  contracts: ['export function exportJson(r: Report): string'],
  dataChanges: [],
  testStrategy: ['unit test exportJson for AC1'],
});

function architectProvider(): FakeLlmProvider {
  return new FakeLlmProvider([textResponse(planJson, { inputTokens: 600, outputTokens: 300 })]);
}

async function seedSpecifiedRun(store: InMemoryStore, specData: Spec): Promise<number> {
  const { run } = await store.findOrCreateRun(job.payload, RunState.Received);
  await store.updateRunState(run.id, RunState.Specified);
  await store.updateRunContext(run.id, { spec: { title: 'JSON export' }, specData });
  await store.recordArtifact({
    runId: run.id,
    kind: 'spec',
    path: '.tsukinome/42/spec.md',
    content: '# Spec — JSON export',
    commitSha: 'aaa',
  });
  return run.id;
}

function planDeps(store: InMemoryStore, provider: FakeLlmProvider, extra?: Partial<PlanHandlerDeps>) {
  const github = fakeGitHub({ language: 'TypeScript' });
  const codeIndex = fakeCodeIndex([
    { path: 'src/report.ts', startLine: 1, endLine: 5, content: 'export interface Report {}' },
  ]);
  const clone = fakeCloneRepo();
  const deps: PlanHandlerDeps = {
    store,
    github,
    gateway: new LlmGateway(provider, store, silentLog),
    codeIndex,
    cloneRepo: clone.fn,
    log: silentLog,
    ...extra,
  };
  return { deps, github, codeIndex, clone };
}

describe('handleProducePlan', () => {
  let store: InMemoryStore;
  beforeEach(() => {
    store = new InMemoryStore();
  });

  it('indexes, retrieves, produces a plan, commits it, and parks for approval', async () => {
    const runId = await seedSpecifiedRun(store, cleanSpec);
    const { deps, github, codeIndex, clone } = planDeps(store, architectProvider());

    await handleProducePlan(job, deps);

    // Retrieval lifecycle, with teardown.
    expect(clone.fn).toHaveBeenCalledTimes(1);
    expect(codeIndex.indexRepo).toHaveBeenCalledTimes(1);
    expect(codeIndex.retrieve).toHaveBeenCalledTimes(1);
    expect(codeIndex.dropNamespace).toHaveBeenCalledTimes(1);
    expect(clone.cleanup).toHaveBeenCalledTimes(1);

    // Plan committed + recorded, gate comment posted, run parked.
    const commit = github.commitFile.mock.calls[0]![0];
    expect(commit.path).toBe('.tsukinome/42/plan.md');
    expect(commit.content).toContain('src/export.ts');
    const artifact = await store.getArtifact(runId, 'plan');
    expect(artifact!.path).toBe('.tsukinome/42/plan.md');
    expect(github.calls[0]!.body).toContain('/approve');
    expect((await store.getRunById(runId))!.state).toBe(RunState.AwaitingPlanApproval);
  });

  it('refuses the plan gate with open questions — DoR routes back to clarification', async () => {
    const runId = await seedSpecifiedRun(store, { ...cleanSpec, openQuestions: ['Which format?'] });
    const provider = architectProvider();
    const { deps, github, codeIndex } = planDeps(store, provider);

    await handleProducePlan(job, deps);

    expect(provider.requests).toHaveLength(0); // architect never ran
    expect(codeIndex.indexRepo).not.toHaveBeenCalled();
    expect(await store.getArtifact(runId, 'plan')).toBeNull();
    expect(github.postIssueComment).toHaveBeenCalled(); // "not ready" comment
    expect((await store.getRunById(runId))!.state).toBe(RunState.Specifying);
    // Routed back to the clarification gate.
    expect((await store.claimNextJob())!.type).toBe('clarify');
  });

  it('stops gracefully (not looping) if DoR still fails after one reclarification', async () => {
    const runId = await seedSpecifiedRun(store, { ...cleanSpec, openQuestions: ['Which format?'] });
    const run = await store.getRunById(runId);
    await store.updateRunContext(runId, { ...run!.context, dorReclarified: true });
    const { deps } = planDeps(store, architectProvider());

    await handleProducePlan(job, deps);

    expect((await store.getRunById(runId))!.state).toBe(RunState.Failed);
  });

  it('is idempotent — skips when a plan artifact already exists', async () => {
    const runId = await seedSpecifiedRun(store, cleanSpec);
    await store.recordArtifact({ runId, kind: 'plan', path: '.tsukinome/42/plan.md', content: '# Plan' });
    const provider = architectProvider();
    const { deps, github } = planDeps(store, provider);

    await handleProducePlan(job, deps);

    expect(provider.requests).toHaveLength(0);
    expect(github.commitFile).not.toHaveBeenCalled();
  });

  it('stops gracefully on budget exhaustion, still tearing down the index', async () => {
    const runId = await seedSpecifiedRun(store, cleanSpec);
    await store.setRunBudget(runId, 0); // architect call will be refused
    const { deps, github, codeIndex, clone } = planDeps(store, architectProvider());

    await handleProducePlan(job, deps);

    expect(await store.getArtifact(runId, 'plan')).toBeNull();
    expect((await store.getRunById(runId))!.state).toBe(RunState.Failed);
    expect(github.postIssueComment).toHaveBeenCalled();
    // Teardown must still run.
    expect(codeIndex.dropNamespace).toHaveBeenCalledTimes(1);
    expect(clone.cleanup).toHaveBeenCalledTimes(1);
  });
});

describe('handleProducePlan — test-setup detection (Phase 15)', () => {
  let store: InMemoryStore;
  const checkouts: string[] = [];

  beforeEach(() => {
    store = new InMemoryStore();
  });

  afterAll(async () => {
    await Promise.all(checkouts.map((d) => rm(d, { recursive: true, force: true })));
  });

  /**
   * A real git checkout on disk — detection reads the working tree via `git ls-files` + the host
   * file reader, so an in-memory fake would not exercise the thing under test.
   */
  async function realCheckout(files: Record<string, string>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'tsukinome-detect-'));
    checkouts.push(dir);
    for (const [path, content] of Object.entries(files)) {
      await mkdir(join(dir, dirname(path)), { recursive: true });
      await writeFile(join(dir, path), content);
    }
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '-A'], { cwd: dir });
    return dir;
  }

  const cloneOf = (dir: string) => {
    const cleanup = vi.fn();
    return { fn: vi.fn(async () => ({ dir, cleanup })), cleanup };
  };

  it('surfaces the missing test setup at the plan gate and records consent', async () => {
    const runId = await seedSpecifiedRun(store, cleanSpec);
    const dir = await realCheckout({
      'package.json': JSON.stringify({ name: 'acme', scripts: { build: 'tsc' } }),
      'src/report.ts': 'export interface Report {}',
    });
    const clone = cloneOf(dir);
    const { deps, github } = planDeps(store, architectProvider(), { cloneRepo: clone.fn });

    await handleProducePlan(job, deps);

    // The human is told which framework will be added, before approving.
    expect(github.calls[0]!.body).toContain('vitest');
    expect(github.calls[0]!.body).toContain('/approve');
    // Consent is persisted for the implement step to read back.
    const run = (await store.getRunById(runId))!;
    expect(run.context.bootstrap).toEqual({ runner: 'vitest', action: 'full' });
    expect(run.state).toBe(RunState.AwaitingPlanApproval);
  });

  it('says nothing about test setup for a repo that already has one', async () => {
    const runId = await seedSpecifiedRun(store, cleanSpec);
    const dir = await realCheckout({
      'package.json': JSON.stringify({ name: 'acme', scripts: { test: 'vitest run' } }),
      'test/report.test.ts': 'it("works", () => {});',
    });
    const clone = cloneOf(dir);
    const { deps, github } = planDeps(store, architectProvider(), { cloneRepo: clone.fn });

    await handleProducePlan(job, deps);

    expect(github.calls[0]!.body).not.toContain('no test runner');
    expect((await store.getRunById(runId))!.context.bootstrap).toBeUndefined();
  });

  it('refuses gracefully when the language pack has no scaffolding recipe', async () => {
    const runId = await seedSpecifiedRun(store, cleanSpec);
    const dir = await realCheckout({ 'package.json': JSON.stringify({ name: 'acme' }) });
    const clone = cloneOf(dir);
    const { deps, github } = planDeps(store, architectProvider(), { cloneRepo: clone.fn });

    const original = TYPESCRIPT_JAVASCRIPT.bootstrap;
    try {
      // Simulate a supported language whose pack cannot scaffold a test setup.
      TYPESCRIPT_JAVASCRIPT.bootstrap = undefined;
      await handleProducePlan(job, deps);
    } finally {
      TYPESCRIPT_JAVASCRIPT.bootstrap = original;
    }

    const run = (await store.getRunById(runId))!;
    expect(run.state).toBe(RunState.Failed);
    expect(github.calls[0]!.body).toMatch(/test runner/i);
    // Refused before spending the Opus plan call, and nothing was committed.
    expect(github.commitFile).not.toHaveBeenCalled();
  });
});
