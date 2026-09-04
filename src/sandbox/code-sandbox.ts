import type { Logger } from '../log.js';
import { DEFAULT_TOOLCHAIN, type Toolchain } from '../toolchain/toolchain.js';
import type {
  CommandResult,
  RunCommandOptions,
  SandboxHandle,
  SandboxProvider,
  TestRunResult,
} from './types.js';

/**
 * A persistent sandbox session for the TDD loop: clone + install once, then write
 * agent-produced files, run the suite, and read files back, iteratively. Built on the
 * Phase-2 `SandboxProvider`/`runCommand` (base64 file transfer — no new handle methods).
 * The real impl is E2B-backed and gated; the TDD engine consumes this interface and is
 * unit-tested with a fake.
 */
export interface CodeSandbox {
  /** Write whole files into the checkout (creating dirs as needed). */
  writeFiles(files: { path: string; content: string }[]): Promise<void>;
  /** Run the repo's test suite over the current working tree. */
  runTests(): Promise<TestRunResult>;
  /** Read files back from the checkout (missing files are omitted). */
  readFiles(paths: string[]): Promise<{ path: string; content: string }[]>;
  /** List the checkout's tracked files (repo-relative paths), for repo-map / example lookups. */
  listFiles(): Promise<string[]>;
  /**
   * Run a one-off setup command in the checkout — used by the Phase-15 test-setup bootstrap to add
   * a test runner. Deliberately named for that purpose rather than a general `exec`: the TDD loop
   * runs the suite through `runTests`, and repo-supplied commands must never gain a host-side path.
   */
  runSetup(command: string): Promise<{ exitCode: number; outputTail: string }>;
  /** Tear the sandbox down. Safe to call once. */
  close(): Promise<void>;
}

export interface OpenCodeSandboxInput {
  /** Least-privilege installation token, used only as the clone credential. */
  token: string;
  owner: string;
  repo: string;
  ref: string;
}

export interface OpenCodeSandboxDeps {
  sandboxProvider: SandboxProvider;
  log: Logger;
  /** Ceiling for a single command. Default `DEFAULT_COMMAND_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Sandbox lifetime, refreshed before each command. Default `DEFAULT_SESSION_TIMEOUT_MS`. */
  sessionTimeoutMs?: number;
  /** Language pack driving the install/test commands. Defaults to TypeScript/JavaScript. */
  toolchain?: Toolchain;
}

/**
 * The sandbox could not be prepared — the clone or the dependency install failed. This is a
 * property of the repo + image, not a transient blip: `python: command not found` cannot become
 * true on the next attempt. The worker treats it as terminal and refuses once, rather than
 * burning the retry budget (same reasoning as `MissingInstallationKeyError`).
 */
export class SandboxSetupError extends Error {
  constructor(
    readonly command: string,
    readonly outputTail: string,
  ) {
    super(`${command} failed: ${outputTail}`);
    this.name = 'SandboxSetupError';
  }
}

const CLONE_DIR = 'repo';
const OUTPUT_TAIL_CAP = 4000;
/** Ceiling for a single command — long enough for `npm ci` or a full test suite. */
export const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60_000;
/**
 * How long the sandbox outlives its last command. This is a leak backstop, not a work budget:
 * it is refreshed before every command, so a session lives as long as work keeps happening and
 * dies shortly after we stop (or crash). It must comfortably exceed the gap between commands —
 * the TDD loop makes several model calls between them.
 */
export const DEFAULT_SESSION_TIMEOUT_MS = 30 * 60_000;

function tail(...parts: string[]): string {
  const combined = parts.filter(Boolean).join('\n');
  return combined.length > OUTPUT_TAIL_CAP ? combined.slice(-OUTPUT_TAIL_CAP) : combined;
}

function redact(text: string, token: string): string {
  return token ? text.split(token).join('***') : text;
}

/** Classify a raw test-command result into our pass/fail vocabulary. */
export function classifyTestRun(
  exitCode: number,
  durationMs: number,
  stdout: string,
  stderr: string,
  command: string = DEFAULT_TOOLCHAIN.testCmd,
): TestRunResult {
  const passed = exitCode === 0;
  return {
    status: passed ? 'passed' : 'failed',
    passed,
    exitCode,
    durationMs,
    command,
    failureStage: passed ? undefined : 'test',
    outputTail: tail(stdout, stderr),
  };
}

/**
 * Open a code session: spin up a sandbox, clone the ref, and install deps. Throws on a
 * clone/install failure (the credential is redacted from the message) after tearing the
 * sandbox down, so the caller never holds a half-open session.
 */
export type OpenCodeSandboxFn = (
  input: OpenCodeSandboxInput,
  deps: OpenCodeSandboxDeps,
) => Promise<CodeSandbox>;

export async function openCodeSandbox(
  input: OpenCodeSandboxInput,
  deps: OpenCodeSandboxDeps,
): Promise<CodeSandbox> {
  const { sandboxProvider } = deps;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const sessionTimeoutMs = deps.sessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
  const toolchain = deps.toolchain ?? DEFAULT_TOOLCHAIN;
  const { token, owner, repo, ref } = input;

  const cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  const handle: SandboxHandle = await sandboxProvider.create({ timeoutMs: sessionTimeoutMs });

  /**
   * Every command goes through here so the death clock is pushed out first. Without it the
   * sandbox expires mid-run while we sit in a model call between commands — which is exactly
   * how a TDD loop dies at the fourth attempt with "connection to sandbox ended".
   */
  const run = async (cmd: string, opts: RunCommandOptions = {}): Promise<CommandResult> => {
    await handle.extendTimeout(sessionTimeoutMs);
    return handle.runCommand(cmd, { ...opts, timeoutMs: opts.timeoutMs ?? timeoutMs });
  };

  try {
    const clone = await run(
      `git clone ${cloneUrl} ${CLONE_DIR} && cd ${CLONE_DIR} && git checkout ${ref}`,
    );
    if (clone.exitCode !== 0) {
      throw new SandboxSetupError('git clone', redact(clone.stderr || clone.stdout, token));
    }
    const install = await run(toolchain.installCmd, { cwd: CLONE_DIR });
    if (install.exitCode !== 0) {
      throw new SandboxSetupError(toolchain.installCmd, tail(install.stdout, install.stderr));
    }
  } catch (err) {
    await handle.kill().catch(() => {});
    throw err;
  }

  return {
    async writeFiles(files) {
      for (const f of files) {
        const b64 = Buffer.from(f.content, 'utf-8').toString('base64');
        const full = `${CLONE_DIR}/${f.path}`;
        const cmd = `mkdir -p "$(dirname '${full}')" && printf '%s' '${b64}' | base64 -d > '${full}'`;
        const res = await run(cmd);
        if (res.exitCode !== 0) throw new Error(`writeFile ${f.path} failed: ${res.stderr}`);
      }
    },

    async runTests() {
      const start = Date.now();
      const res = await run(toolchain.testCmd, { cwd: CLONE_DIR });
      return classifyTestRun(res.exitCode, Date.now() - start, res.stdout, res.stderr, toolchain.testCmd);
    },

    async readFiles(paths) {
      const out: { path: string; content: string }[] = [];
      for (const p of paths) {
        const res = await run(`base64 '${CLONE_DIR}/${p}'`);
        if (res.exitCode !== 0) continue; // file does not exist yet — skip
        out.push({ path: p, content: Buffer.from(res.stdout.trim(), 'base64').toString('utf-8') });
      }
      return out;
    },

    async runSetup(command) {
      const res = await run(command, { cwd: CLONE_DIR });
      return { exitCode: res.exitCode, outputTail: tail(res.stdout, res.stderr) };
    },

    async listFiles() {
      const res = await run('git ls-files', { cwd: CLONE_DIR });
      if (res.exitCode !== 0) return [];
      return res.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
    },

    async close() {
      await handle.kill();
    },
  };
}
