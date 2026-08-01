import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CodeSandbox } from '../sandbox/code-sandbox.js';
import type { FileReader, Toolchain } from '../toolchain/toolchain.js';

/**
 * Phase 15 — classify whether the target repo has a usable test setup, deterministically.
 *
 * Tsukinome's TDD loop needs a runner that collects tests so it can observe red→green. A repo with
 * no runner falls off the happy path entirely, which excludes exactly the codebases a test-first
 * agent helps most. This module decides *whether* to scaffold one; `bootstrap.ts` does it.
 */

/** What the bootstrap step should do for this repo. */
export type BootstrapAction =
  /** A runner is configured — do nothing at all. */
  | 'none'
  /** No runner and no tests — add the runner, its config, and one green example test. */
  | 'full'
  /** Tests exist but nothing runs them — add the runner only; never author or edit their tests. */
  | 'runner-only';

export interface TestSetupVerdict {
  hasRunner: boolean;
  hasTests: boolean;
  action: BootstrapAction;
  /** Human-readable rationale, surfaced at the plan gate and in the PR body. */
  reason: string;
}

/** The consent record persisted on the run at the plan gate and read back when implementing. */
export interface BootstrapConsent {
  runner: string;
  action: Exclude<BootstrapAction, 'none'>;
}

/** Read files from a local checkout directory (plan time — the host clone). */
export function hostReader(dir: string): FileReader {
  return async (path) => {
    try {
      return await readFile(join(dir, path), 'utf-8');
    } catch {
      return undefined;
    }
  };
}

/** Read files from an open sandbox session (implement time). */
export function sandboxReader(sandbox: CodeSandbox): FileReader {
  return async (path) => {
    const [found] = await sandbox.readFiles([path]);
    return found?.content;
  };
}

/**
 * Classify a repo's test setup. `files` is the tracked-file list; `read` resolves file contents
 * (contents matter — see `Toolchain.hasTestRunner` for why presence alone is not enough).
 *
 * A repo that already has a runner returns `none` **whether or not it has tests**: the test-author
 * writes the first test, so there is always a test file by the time the suite runs.
 */
export async function detectTestSetup(
  toolchain: Toolchain,
  files: string[],
  read: FileReader,
): Promise<TestSetupVerdict> {
  const hasRunner = await toolchain.hasTestRunner(files, read);
  const hasTests = files.some((f) => toolchain.isTestFile(f));

  if (hasRunner) {
    return { hasRunner, hasTests, action: 'none', reason: 'This repo already has a test runner configured.' };
  }
  if (hasTests) {
    return {
      hasRunner,
      hasTests,
      action: 'runner-only',
      reason: 'This repo has test files but no configured test runner.',
    };
  }
  return {
    hasRunner,
    hasTests,
    action: 'full',
    reason: 'This repo has no test runner and no tests.',
  };
}

/**
 * The one-line disclosure shown at the plan gate (`planned`) and in the PR body (`done`). Choosing
 * a test framework for someone is opinionated, so it is always stated explicitly and lands as its
 * own commit the reviewer can drop.
 */
export function renderTestSetupNote(
  bootstrap: BootstrapConsent,
  tense: 'planned' | 'done',
): string {
  const { runner, action } = bootstrap;
  const what =
    action === 'runner-only'
      ? `a minimal **${runner}** setup so the existing tests can run (existing test files are left untouched)`
      : `a minimal **${runner}** setup — runner config plus one trivial passing test that proves it collects`;

  return tense === 'planned'
    ? `⚠️ **This repo has no test runner.** Tsukinome works test-first, so it will add ${what}, as its own commit before any feature work.`
    : `This repo had no test runner, so Tsukinome added ${what}. It is a separate commit and can be dropped independently of the feature work.`;
}

/**
 * The repo needs a test setup but its language pack has no recipe for one. Thrown before the
 * Architect call so we refuse without spending on a plan we could never implement.
 */
export class BootstrapUnavailableError extends Error {
  constructor(readonly toolchain: Toolchain) {
    super(`no test-setup recipe for ${toolchain.displayName}`);
    this.name = 'BootstrapUnavailableError';
  }
}

/** Plan-gate refusal: no test setup, and this language pack has no scaffolding recipe. */
export function renderNoRecipeComment(toolchain: Toolchain): string {
  return (
    `🛑 **I can't work on this repo yet.** It has no test runner configured, and I don't have a ` +
    `test-setup recipe for ${toolchain.displayName} — so I can't establish the green baseline my ` +
    `test-first loop needs.\n\n` +
    `Set up a test runner in the repo and open the issue again, and I'll pick it up from there.`
  );
}

/** Implement-time refusal: the scaffolding was written but the suite would not go green. */
export function renderBootstrapFailedComment(runner: string, outputTail?: string): string {
  const detail = outputTail ? `\n\n<details><summary>Output</summary>\n\n\`\`\`\n${outputTail}\n\`\`\`\n\n</details>` : '';
  return (
    `🛑 **I couldn't set up ${runner} on this repo.** I tried to add a minimal test setup so I ` +
    `could work test-first, but the suite didn't come out green — so I've committed nothing and ` +
    `stopped rather than build on a broken baseline.${detail}\n\n` +
    `This usually means the repo needs its test runner configured by hand first (or existing tests ` +
    `are failing). Once \`${runner}\` runs green, re-open the issue and I'll take it from there.`
  );
}
