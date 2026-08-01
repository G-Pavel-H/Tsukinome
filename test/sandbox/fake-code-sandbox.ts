import type { CodeSandbox } from '../../src/sandbox/code-sandbox.js';
import type { TestRunStatus, TestRunResult } from '../../src/sandbox/types.js';

/** In-memory CodeSandbox for engine tests: real read/write FS + scripted test outcomes. */
export class FakeCodeSandbox implements CodeSandbox {
  readonly files = new Map<string, string>();
  readonly writes: { path: string; content: string }[][] = [];
  readonly testRuns: TestRunStatus[] = [];
  /** Setup commands run via runSetup(), in order (Phase 15 bootstrap). */
  readonly setupCommands: string[] = [];
  /** Exit code returned by runSetup() — set to non-zero to script an install failure. */
  setupExitCode = 0;
  closed = 0;

  /** Queue of test outcomes returned by successive runTests() calls (default: passed). */
  constructor(private readonly queue: TestRunStatus[] = []) {}

  async runSetup(command: string): Promise<{ exitCode: number; outputTail: string }> {
    this.setupCommands.push(command);
    return {
      exitCode: this.setupExitCode,
      outputTail: this.setupExitCode === 0 ? '' : `setup-failure: ${command}`,
    };
  }

  async writeFiles(files: { path: string; content: string }[]): Promise<void> {
    this.writes.push(files);
    for (const f of files) this.files.set(f.path, f.content);
  }

  async runTests(): Promise<TestRunResult> {
    const status = this.queue.shift() ?? 'passed';
    this.testRuns.push(status);
    const passed = status === 'passed';
    return {
      status,
      passed,
      exitCode: passed ? 0 : 1,
      durationMs: 1,
      command: 'npm test',
      failureStage: passed ? undefined : 'test',
      // Distinct per-run marker so tests can prove the failure output is threaded onward.
      outputTail: passed ? '' : `vitest-failure-#${this.testRuns.length}`,
    };
  }

  async readFiles(paths: string[]): Promise<{ path: string; content: string }[]> {
    return paths.filter((p) => this.files.has(p)).map((p) => ({ path: p, content: this.files.get(p)! }));
  }

  async listFiles(): Promise<string[]> {
    return [...this.files.keys()];
  }

  async close(): Promise<void> {
    this.closed += 1;
  }
}
