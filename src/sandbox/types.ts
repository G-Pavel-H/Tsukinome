/** Result of running one command in a sandbox (non-zero exit is data, not an error). */
export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunCommandOptions {
  /** Working directory inside the sandbox. */
  cwd?: string;
  /** Hard timeout for this command. */
  timeoutMs?: number;
}

export interface SandboxHandle {
  readonly id: string;
  runCommand(cmd: string, opts?: RunCommandOptions): Promise<CommandResult>;
  /** Tear the sandbox down. Must be safe to call exactly once per handle. */
  kill(): Promise<void>;
}

export interface CreateSandboxOptions {
  /** Max sandbox lifetime; the provider auto-kills past this as a teardown backstop. */
  timeoutMs?: number;
}

/** Creates ephemeral sandboxes. Real impl is E2B; tests use a fake. */
export interface SandboxProvider {
  create(opts?: CreateSandboxOptions): Promise<SandboxHandle>;
}

/**
 * Outcome of a test run:
 * - `passed`: the suite ran and was green.
 * - `failed`: the suite ran and was red.
 * - `error`: the suite could not be run (clone/install failed, or sandbox error).
 */
export type TestRunStatus = 'passed' | 'failed' | 'error';

export type TestFailureStage = 'clone' | 'install' | 'test';

export interface TestRunResult {
  status: TestRunStatus;
  passed: boolean;
  /** Exit code of the decisive command; null when nothing produced one. */
  exitCode: number | null;
  /** Wall-clock duration of the test command (or elapsed work before an error). */
  durationMs: number;
  /** Redacted command label — never contains credentials. */
  command: string;
  failureStage?: TestFailureStage;
  /** Truncated tail of combined stdout/stderr for diagnostics. */
  outputTail: string;
}
