import type { GitHubClient } from '../github/client.js';
import type { Logger } from '../log.js';
import { RunState, type Job, type RunTestsPayload, type Store } from '../store/types.js';
import type { SandboxProvider } from '../sandbox/types.js';
import { runTests } from '../sandbox/run-tests.js';

export interface HandlerDeps {
  store: Store;
  github: GitHubClient;
  log: Logger;
}

export interface RunTestsHandlerDeps extends HandlerDeps {
  sandboxProvider: SandboxProvider;
}

/** The acknowledgement comment posted when Tsukinome picks up an issue. */
export const ACK_COMMENT_BODY =
  '🌙 **Tsukinome** has picked this up and will start working on it shortly.';

/**
 * Handle an `issue_opened` job: ensure a run exists and post a single
 * acknowledgement comment.
 *
 * Idempotency (Phase 1, basic): the run is the dedupe record. If it is already
 * past `received`, the comment was posted on a prior attempt, so we skip. The
 * comment is posted before the state advances, so a crash in between can re-post
 * (the known narrow window; hardened in Phase 11). Reprocessing a fully
 * completed job never double-posts.
 */
export async function handleIssueOpened(job: Job, deps: HandlerDeps): Promise<void> {
  const { store, github, log } = deps;
  const { installationId, owner, repo, issueNumber } = job.payload;

  const { run } = await store.findOrCreateRun(
    { installationId, owner, repo, issueNumber },
    RunState.Received,
  );

  if (run.state !== RunState.Received) {
    log.info(
      { jobId: job.id, runId: run.id, state: run.state, repo: `${owner}/${repo}`, issue: issueNumber },
      'Issue already acknowledged; skipping duplicate comment',
    );
    return;
  }

  await github.postIssueComment({
    installationId,
    owner,
    repo,
    issueNumber,
    body: ACK_COMMENT_BODY,
  });

  await store.updateRunState(run.id, RunState.Acknowledged);

  log.info(
    { jobId: job.id, runId: run.id, repo: `${owner}/${repo}`, issue: issueNumber },
    'Posted acknowledgement comment and advanced run to acknowledged',
  );
}

/**
 * Handle a `run_tests` job (Phase 2, debug-triggered): mint a least-privilege
 * token, clone + test the target repo in an ephemeral sandbox, and persist the
 * structured result. Never throws on a red suite — that is recorded as `failed`.
 */
export async function handleRunTests(job: Job, deps: RunTestsHandlerDeps): Promise<void> {
  const { store, github, sandboxProvider, log } = deps;
  // Safe narrow: the worker only routes `run_tests` jobs here.
  const payload = job.payload as RunTestsPayload;
  const { installationId, owner, repo, ref, issueNumber } = payload;

  const { run } = await store.findOrCreateRun(
    { installationId, owner, repo, issueNumber },
    RunState.Received,
  );

  const token = await github.getInstallationToken({ installationId, owner, repo });

  const result = await runTests({ token, owner, repo, ref }, { sandboxProvider, log });

  await store.recordTestRun({
    runId: run.id,
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    command: result.command,
    failureStage: result.failureStage,
    outputTail: result.outputTail,
  });

  log.info(
    {
      jobId: job.id,
      runId: run.id,
      repo: `${owner}/${repo}`,
      ref,
      status: result.status,
      durationMs: result.durationMs,
    },
    'Recorded sandbox test run',
  );
}
