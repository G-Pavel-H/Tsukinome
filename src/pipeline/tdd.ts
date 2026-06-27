import { runAgent } from '../agents/runner.js';
import { BudgetExhaustedError, type LlmGateway } from '../llm/gateway.js';
import type { ModelTier } from '../llm/models.js';
import type { Logger } from '../log.js';
import type { CodeSandbox } from '../sandbox/code-sandbox.js';
import type { FileEdit, FileSet, TaskList } from './schemas.js';

export type TaskSpec = TaskList['tasks'][number];

/** Escalation ladder: try the cheap model first, then promote to Opus, then give up. */
export const SONNET_ATTEMPTS = 2;
export const OPUS_ATTEMPTS = 1;
const LADDER: (ModelTier | undefined)[] = [
  ...Array<undefined>(SONNET_ATTEMPTS).fill(undefined), // role default tier (implementation/Sonnet)
  ...Array<ModelTier>(OPUS_ATTEMPTS).fill('review'), // promote to Opus
];

export interface TddContext {
  sandbox: CodeSandbox;
  gateway: LlmGateway;
  runId: number;
  log: Logger;
  specMarkdown: string;
  planMarkdown: string;
  /** Paths the plan touches — read from the sandbox to give agents real file context. */
  affectedPaths: string[];
}

export interface TaskOutcome {
  status: 'done' | 'escalated';
  /** Which stage failed, when escalated. */
  stage?: 'test' | 'impl';
  redObserved: boolean;
  greenObserved: boolean;
  /** Paths touched across the task (re-read + committed by the caller). */
  changedPaths: string[];
}

/** Break the approved plan into small, independently testable tasks. */
export async function decompose(
  specMarkdown: string,
  planMarkdown: string,
  ctx: { runId: number; gateway: LlmGateway; log: Logger },
): Promise<TaskSpec[]> {
  const result = await runAgent<TaskList>(
    'decomposer',
    { messages: [{ role: 'user', content: `Spec:\n${specMarkdown}\n\nPlan:\n${planMarkdown}` }] },
    ctx,
  );
  return result.output!.tasks;
}

function renderFiles(files: { path: string; content: string }[]): string {
  if (files.length === 0) return '(none yet)';
  return files.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n');
}

function taskHeader(task: TaskSpec): string {
  return (
    `Task ${task.id}: ${task.title}\n${task.description}\n\n` +
    `Acceptance criteria:\n${task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
  );
}

/**
 * Run the TDD trio for one task with a code-enforced ordering: tests must be observed
 * **red** before implementation, then the implementation must make the full suite **green**;
 * a best-effort refactor must keep it green or is reverted. Each stage retries on the cheap
 * model, then promotes to Opus, then **escalates** (no infinite loop). Budget errors
 * propagate to the caller for a graceful stop.
 */
export async function runTaskTdd(task: TaskSpec, ctx: TddContext): Promise<TaskOutcome> {
  const { sandbox, gateway, runId, log } = ctx;
  const agentCtx = { runId, gateway, log };
  const touched = new Set<string>();
  const baseContext =
    `Spec:\n${ctx.specMarkdown}\n\nPlan:\n${ctx.planMarkdown}\n\n${taskHeader(task)}`;

  // --- Test Author: write tests that FAIL now (red). A test that passes pre-impl is rejected. ---
  let testFiles: FileEdit[] = [];
  let redObserved = false;
  for (const tier of LADDER) {
    const current = await sandbox.readFiles(ctx.affectedPaths);
    const out = await runAgent<FileSet>(
      'test-author',
      {
        messages: [{ role: 'user', content: `${baseContext}\n\nCurrent files:\n${renderFiles(current)}` }],
        tierOverride: tier,
      },
      agentCtx,
    );
    testFiles = out.output!.files;
    if (testFiles.length === 0) continue; // produced no tests — retry
    await sandbox.writeFiles(testFiles);
    const result = await sandbox.runTests();
    if (result.status === 'failed') {
      redObserved = true; // good: the new tests fail before any implementation
      break;
    }
    log.info({ runId, task: task.id, status: result.status }, 'Test-author tests did not go red; retrying');
  }
  testFiles.forEach((f) => touched.add(f.path));
  if (!redObserved) {
    return { status: 'escalated', stage: 'test', redObserved: false, greenObserved: false, changedPaths: [...touched] };
  }

  // --- Implementer: minimum code so the new tests pass AND the full suite stays green. ---
  let greenObserved = false;
  for (const tier of LADDER) {
    const current = await sandbox.readFiles(ctx.affectedPaths);
    const out = await runAgent<FileSet>(
      'implementer',
      {
        messages: [
          {
            role: 'user',
            content:
              `${baseContext}\n\nFailing tests:\n${renderFiles(testFiles)}\n\n` +
              `Current files:\n${renderFiles(current)}`,
          },
        ],
        tierOverride: tier,
      },
      agentCtx,
    );
    const implFiles = out.output!.files;
    await sandbox.writeFiles(implFiles);
    implFiles.forEach((f) => touched.add(f.path));
    const result = await sandbox.runTests();
    if (result.status === 'passed') {
      greenObserved = true;
      break;
    }
    log.info({ runId, task: task.id, status: result.status }, 'Implementation not green; retrying');
  }
  if (!greenObserved) {
    return { status: 'escalated', stage: 'impl', redObserved: true, greenObserved: false, changedPaths: [...touched] };
  }

  // --- Refactor (best-effort): clean up while keeping green; revert if it breaks. ---
  try {
    const greenSnapshot = await sandbox.readFiles([...touched]);
    const out = await runAgent<FileSet>(
      'refactor',
      { messages: [{ role: 'user', content: `${baseContext}\n\nCurrent files:\n${renderFiles(greenSnapshot)}` }] },
      agentCtx,
    );
    const refFiles = out.output!.files;
    if (refFiles.length > 0) {
      await sandbox.writeFiles(refFiles);
      const result = await sandbox.runTests();
      if (result.status === 'passed') {
        refFiles.forEach((f) => touched.add(f.path));
      } else {
        await sandbox.writeFiles(greenSnapshot); // revert — keep the green state
        log.info({ runId, task: task.id }, 'Refactor broke tests; reverted');
      }
    }
  } catch (err) {
    if (err instanceof BudgetExhaustedError) throw err; // budget is not best-effort
    log.info({ runId, task: task.id }, 'Refactor step failed; keeping green implementation');
  }

  return { status: 'done', redObserved: true, greenObserved: true, changedPaths: [...touched] };
}
