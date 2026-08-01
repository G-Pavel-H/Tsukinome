import type { Logger } from '../log.js';
import type { CodeSandbox } from '../sandbox/code-sandbox.js';
import type { Toolchain } from '../toolchain/toolchain.js';
import type { BootstrapAction } from './test-setup.js';

/**
 * Phase 15 — scaffold a minimal test setup into an open sandbox session.
 *
 * The load-bearing property is that the bootstrap is **verified before it is committed**: write the
 * config, install the runner, then run the suite and require green. A runner config that doesn't
 * actually collect tests would make the TDD loop's first red unfixable — the implementer can't
 * repair it because it may not edit tests — so a bootstrap we can't prove works is never committed.
 *
 * Pure orchestration over the injected sandbox; committing is the caller's job (all git writes stay
 * in the deterministic Integrator).
 */

export interface BootstrapResult {
  /** `green` — verified, safe to commit. `not-green` — do not commit. `no-recipe` — nothing tried. */
  status: 'green' | 'not-green' | 'no-recipe';
  /** Paths to read back and commit (recipe files + whatever the install rewrote). */
  changedPaths: string[];
  /** The framework installed, when one was. */
  runner?: string;
  /** On failure: the tail of the install or test output, so a human sees why. */
  outputTail?: string;
}

export async function runBootstrap(
  toolchain: Toolchain,
  action: Exclude<BootstrapAction, 'none'>,
  sandbox: CodeSandbox,
  log?: Logger,
): Promise<BootstrapResult> {
  const recipe = toolchain.bootstrap;
  if (!recipe) return { status: 'no-recipe', changedPaths: [] };

  // Hand the recipe the current manifest so it merges into it rather than clobbering it.
  const [manifest] = await sandbox.readFiles([toolchain.projectManifest]);
  const files = recipe.configFiles(manifest?.content);
  // `runner-only` means the repo already has tests: they are the tests, so we never author one.
  if (action === 'full') files.push(recipe.exampleTest());

  await sandbox.writeFiles(files);

  const setup = await sandbox.runSetup(recipe.addRunnerCmd);
  if (setup.exitCode !== 0) {
    log?.warn({ runner: recipe.runner, cmd: recipe.addRunnerCmd }, 'Test-setup bootstrap: install failed');
    return { status: 'not-green', changedPaths: [], runner: recipe.runner, outputTail: setup.outputTail };
  }

  // The proof: the runner must actually collect and pass. `runner-only` additionally requires the
  // repo's own pre-existing tests to pass — if they don't, that is a repo problem we must not
  // silently "fix" by touching their tests, so we refuse instead.
  const result = await sandbox.runTests();
  if (result.status !== 'passed') {
    log?.warn({ runner: recipe.runner, status: result.status }, 'Test-setup bootstrap: suite not green');
    return { status: 'not-green', changedPaths: [], runner: recipe.runner, outputTail: result.outputTail };
  }

  const changedPaths = [...new Set([...files.map((f) => f.path), ...recipe.installArtifacts])];
  return { status: 'green', changedPaths, runner: recipe.runner };
}
