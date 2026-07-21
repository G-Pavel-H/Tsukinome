import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Probot, ProbotOctokit } from 'probot';
import { createApp } from '../src/app.js';
import { InMemoryStore } from '../src/store/memory-store.js';
import { CredentialVault } from '../src/secrets/credential-vault.js';
import { RunState, type RunKey } from '../src/store/types.js';
import { silentLog } from './helpers.js';

const TEST_PRIVATE_KEY =
  '-----BEGIN RSA PRIVATE KEY-----\n' +
  'MIIEowIBAAKCAQEA2a2rwplBQLzHPZe5RaAkn6YRCb7VcMl0v+UYbNgP2JCbgjsT\n' +
  'pKqgEIVmkGkLMekPCqe+nBDDfBIGMIW/iKqYGT0JQm35SFLi4OUIMT0Dqz8TJno\n' +
  'yqENGa4RXt15y2GJLRy6S+jGsDdNbNlCb+cjaJuf2y8g6+nfzZ5R6jLgJ2VCBGn0\n' +
  'LRe/Fp4F3dC0okkHoeqEa2YBPnMiGxYJFSTbabWwY2p7OCtAp3MXemjn7tVh8TIp\n' +
  'RsKDtl9IUot6Di8RDM8CoviGDieTr/NDXMnGl2gOKUjuOK8RdHDBfP/kPaGdOzV1\n' +
  'x7ADqIsoSt/MqEFOdp4IBkjZAFXFJCGR1j8VrwIDAQABAoIBAFH1WfXFNMf94MnL\n' +
  'T0S3Tp4RXf4k0mIG1o2GjSOoEjHbjMN0X0z38rK0xGjsRVEJmmQOvMHJ8SHgMuuQ\n' +
  'm/HhRs/xrHz5RrOBHh54bm+MQ4W5jCPlMNiA1FgWaFYbsnm1SmP/upgHgVsFRGex\n' +
  'WJQIaFy03V6wqiGwHJjYMFREjS9eBY0JiZBTxCMgi6GfzUz9fXiRPXRBx7lhPFfe\n' +
  'Rjd1GCIKTvqCW0d2tPyQVEImOE4MG8Eq8EjW4C9X/LumaN9DEnWaKpWfLGmd4oH5\n' +
  'zKsHBi3DKFKtR/gHM1DGvBVeOAEj2K0O0s+yBfrHIl3VJQYefR7LcLBgMN1GJgt3\n' +
  'OGITURECgYEA72t+cnIDE2A3sUwDTNjSxXW0H44wAMEfMm/f+bz6GkECQOlDl7K0\n' +
  'y5p6IOKXLfxGJMrmIaqPR6Xr/CzAh4jLEKvD4Fvk/LiL7fOjcoX8hVBN3dj/O7y\n' +
  'VQCTMXxw4e3Bt7TXx/fTTTMm0fKxsEoZ2lv+NfR+L8QR6LON/wJHnOkCgYEA6J7r\n' +
  '-----END RSA PRIVATE KEY-----\n';

function buildProbot(store: InMemoryStore, vault?: CredentialVault): Probot {
  const probot = new Probot({
    appId: 1,
    privateKey: TEST_PRIVATE_KEY,
    secret: 'test-secret',
    logLevel: 'silent',
    Octokit: ProbotOctokit.defaults({
      retry: { enabled: false },
      throttle: { enabled: false },
    }),
  });
  // Load with the app factory bound to our in-memory store.
  void probot.load(
    createApp({ store, vault: vault ?? new CredentialVault(store, randomBytes(32)), log: silentLog }),
  );
  return probot;
}

function issuesOpenedPayload() {
  return {
    action: 'opened',
    issue: { number: 42, title: 'Test issue', body: 'A body' },
    repository: {
      full_name: 'acme/widgets',
      name: 'widgets',
      owner: { login: 'acme' },
    },
    installation: { id: 7 },
  } as const;
}

describe('createApp — issues.opened', () => {
  let store: InMemoryStore;
  let probot: Probot;
  beforeEach(async () => {
    store = new InMemoryStore();
    probot = buildProbot(store);
  });

  it('enqueues an issue_opened job carrying the issue coordinates', async () => {
    await probot.receive({ id: 'delivery-1', name: 'issues', payload: issuesOpenedPayload() as never });

    const job = await store.claimNextJob();
    expect(job).not.toBeNull();
    expect(job!.type).toBe('issue_opened');
    expect(job!.payload).toMatchObject({
      installationId: 7,
      owner: 'acme',
      repo: 'widgets',
      issueNumber: 42,
      deliveryId: 'delivery-1',
    });
  });

  it('enqueues only once for a duplicate webhook delivery', async () => {
    await probot.receive({ id: 'dup', name: 'issues', payload: issuesOpenedPayload() as never });
    await probot.receive({ id: 'dup', name: 'issues', payload: issuesOpenedPayload() as never });

    expect(await store.claimNextJob()).not.toBeNull();
    expect(await store.claimNextJob()).toBeNull();
  });
});

function installationDeletedPayload() {
  return {
    action: 'deleted',
    installation: { id: 7, account: { login: 'acme' } },
  } as const;
}

describe('createApp — installation.deleted (Phase 12b uninstall purge)', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  it("purges the installation's stored key on uninstall", async () => {
    const vault = new CredentialVault(store, randomBytes(32));
    const purge = vi.spyOn(vault, 'purge');
    const probot = buildProbot(store, vault);

    await probot.receive({
      id: 'uninstall-1',
      name: 'installation',
      payload: installationDeletedPayload() as never,
    });

    expect(purge).toHaveBeenCalledWith(7);
  });

  it('ignores a duplicate uninstall delivery', async () => {
    const vault = new CredentialVault(store, randomBytes(32));
    const purge = vi.spyOn(vault, 'purge');
    const probot = buildProbot(store, vault);

    const payload = installationDeletedPayload() as never;
    await probot.receive({ id: 'uninstall-dup', name: 'installation', payload });
    await probot.receive({ id: 'uninstall-dup', name: 'installation', payload });

    expect(purge).toHaveBeenCalledTimes(1);
  });
});

const PARKED_KEY: RunKey = {
  installationId: 7,
  owner: 'acme',
  repo: 'widgets',
  issueNumber: 42,
};

function issueCommentPayload(opts: { body?: string; userType?: 'User' | 'Bot' } = {}) {
  return {
    action: 'created',
    comment: {
      body: opts.body ?? 'Use JSON, and UTC timestamps.',
      user: { login: 'maintainer', type: opts.userType ?? 'User' },
    },
    issue: { number: 42, title: 'Test issue', body: 'A body' },
    repository: {
      full_name: 'acme/widgets',
      name: 'widgets',
      owner: { login: 'acme' },
    },
    installation: { id: 7 },
  } as const;
}

describe('createApp — issue_comment.created (clarification resume)', () => {
  let store: InMemoryStore;
  let probot: Probot;
  beforeEach(async () => {
    store = new InMemoryStore();
    probot = buildProbot(store);
  });

  async function park(): Promise<void> {
    const { run } = await store.findOrCreateRun(PARKED_KEY, RunState.Received);
    await store.updateRunState(run.id, RunState.AwaitingClarification);
  }

  it('enqueues a resume_clarification job when a human replies on a parked run', async () => {
    await park();
    await probot.receive({
      id: 'c-1',
      name: 'issue_comment',
      payload: issueCommentPayload() as never,
    });

    const job = await store.claimNextJob();
    expect(job!.type).toBe('resume_clarification');
    expect(job!.payload).toMatchObject({
      installationId: 7,
      owner: 'acme',
      repo: 'widgets',
      issueNumber: 42,
      commentBody: 'Use JSON, and UTC timestamps.',
    });
  });

  it('enqueues a resume_plan_decision job when a human replies at the plan gate', async () => {
    const { run } = await store.findOrCreateRun(PARKED_KEY, RunState.Received);
    await store.updateRunState(run.id, RunState.AwaitingPlanApproval);

    await probot.receive({
      id: 'c-plan',
      name: 'issue_comment',
      payload: issueCommentPayload({ body: '/approve' }) as never,
    });

    const job = await store.claimNextJob();
    expect(job!.type).toBe('resume_plan_decision');
    expect(job!.payload).toMatchObject({ issueNumber: 42, commentBody: '/approve' });
  });

  it('ignores bot comments (never resumes on its own question comment)', async () => {
    await park();
    await probot.receive({
      id: 'c-bot',
      name: 'issue_comment',
      payload: issueCommentPayload({ userType: 'Bot' }) as never,
    });

    expect(await store.claimNextJob()).toBeNull();
  });

  it('is a no-op when the run is not awaiting clarification', async () => {
    // Run exists but in a different state.
    const { run } = await store.findOrCreateRun(PARKED_KEY, RunState.Received);
    await store.updateRunState(run.id, RunState.Specified);

    await probot.receive({
      id: 'c-2',
      name: 'issue_comment',
      payload: issueCommentPayload() as never,
    });

    expect(await store.claimNextJob()).toBeNull();
  });

  it('is a no-op when no run exists for the issue', async () => {
    await probot.receive({
      id: 'c-3',
      name: 'issue_comment',
      payload: issueCommentPayload() as never,
    });
    expect(await store.claimNextJob()).toBeNull();
  });

  it('enqueues only once for a duplicate comment delivery', async () => {
    await park();
    const payload = issueCommentPayload();
    await probot.receive({ id: 'dup-c', name: 'issue_comment', payload: payload as never });
    await probot.receive({ id: 'dup-c', name: 'issue_comment', payload: payload as never });

    expect(await store.claimNextJob()).not.toBeNull();
    expect(await store.claimNextJob()).toBeNull();
  });
});

function reviewCommentPayload(opts: { ref?: string; userType?: 'User' | 'Bot' } = {}) {
  return {
    action: 'created',
    comment: {
      id: 1001,
      body: 'handle the empty input case',
      path: 'src/add.ts',
      user: { login: 'maintainer', type: opts.userType ?? 'User' },
    },
    pull_request: { number: 7, head: { ref: opts.ref ?? 'tsukinome/issue-42' } },
    repository: { full_name: 'acme/widgets', name: 'widgets', owner: { login: 'acme' } },
    installation: { id: 7 },
  } as const;
}

function reviewPayload(opts: { state?: string; userType?: 'User' | 'Bot' } = {}) {
  return {
    action: 'submitted',
    review: {
      body: 'please address these',
      state: opts.state ?? 'changes_requested',
      user: { login: 'maintainer', type: opts.userType ?? 'User' },
    },
    pull_request: { number: 7, head: { ref: 'tsukinome/issue-42' } },
    repository: { full_name: 'acme/widgets', name: 'widgets', owner: { login: 'acme' } },
    installation: { id: 7 },
  } as const;
}

describe('createApp — PR review fix loop', () => {
  let store: InMemoryStore;
  let probot: Probot;
  beforeEach(async () => {
    store = new InMemoryStore();
    probot = buildProbot(store);
  });

  async function parkPr(): Promise<void> {
    const { run } = await store.findOrCreateRun(PARKED_KEY, RunState.Received);
    await store.updateRunState(run.id, RunState.AwaitingPrReview);
  }

  it('enqueues a fix job from an inline review comment on a parked PR', async () => {
    await parkPr();
    await probot.receive({ id: 'rc-1', name: 'pull_request_review_comment', payload: reviewCommentPayload() as never });

    const job = await store.claimNextJob();
    expect(job!.type).toBe('fix');
    expect(job!.payload).toMatchObject({
      issueNumber: 42,
      prNumber: 7,
      commentBody: 'handle the empty input case',
      filePath: 'src/add.ts',
      reviewCommentId: 1001,
    });
  });

  it('ignores bot review comments and non-tsukinome branches', async () => {
    await parkPr();
    await probot.receive({ id: 'rc-bot', name: 'pull_request_review_comment', payload: reviewCommentPayload({ userType: 'Bot' }) as never });
    await probot.receive({ id: 'rc-other', name: 'pull_request_review_comment', payload: reviewCommentPayload({ ref: 'feature/x' }) as never });
    expect(await store.claimNextJob()).toBeNull();
  });

  it('enqueues a fix from a changes-requested review but ignores an approval', async () => {
    await parkPr();
    await probot.receive({ id: 'rv-approve', name: 'pull_request_review', payload: reviewPayload({ state: 'approved' }) as never });
    expect(await store.claimNextJob()).toBeNull();

    await probot.receive({ id: 'rv-changes', name: 'pull_request_review', payload: reviewPayload() as never });
    const job = await store.claimNextJob();
    expect(job!.type).toBe('fix');
    expect(job!.payload).toMatchObject({ issueNumber: 42, prNumber: 7, commentBody: 'please address these' });
  });

  it('ignores review comments when the run is not awaiting PR review', async () => {
    const { run } = await store.findOrCreateRun(PARKED_KEY, RunState.Received);
    await store.updateRunState(run.id, RunState.Implementing);
    await probot.receive({ id: 'rc-2', name: 'pull_request_review_comment', payload: reviewCommentPayload() as never });
    expect(await store.claimNextJob()).toBeNull();
  });
});
