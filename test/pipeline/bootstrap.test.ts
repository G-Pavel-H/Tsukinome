import { describe, it, expect } from 'vitest';
import { runBootstrap } from '../../src/pipeline/bootstrap.js';
import { PYTHON, TYPESCRIPT_JAVASCRIPT, type Toolchain } from '../../src/toolchain/toolchain.js';
import { FakeCodeSandbox } from '../sandbox/fake-code-sandbox.js';

/** A supported pack that has no scaffolding recipe — the graceful-refusal path. */
const NO_RECIPE_PACK: Toolchain = { ...TYPESCRIPT_JAVASCRIPT, id: 'no-recipe', bootstrap: undefined };

describe('runBootstrap', () => {
  it('writes the config + example test, installs the runner, and reports green', async () => {
    const sandbox = new FakeCodeSandbox(['passed']);
    sandbox.files.set('package.json', JSON.stringify({ name: 'acme', scripts: { build: 'tsc' } }));

    const result = await runBootstrap(TYPESCRIPT_JAVASCRIPT, 'full', sandbox);

    expect(result.status).toBe('green');
    expect(result.runner).toBe('vitest');
    // The runner was actually installed, not just configured.
    expect(sandbox.setupCommands).toEqual([TYPESCRIPT_JAVASCRIPT.bootstrap!.addRunnerCmd]);
    // Config + example test are in the checkout.
    expect(sandbox.files.has('vitest.config.ts')).toBe(true);
    expect(sandbox.files.has(TYPESCRIPT_JAVASCRIPT.bootstrap!.exampleTest().path)).toBe(true);
    // The suite was actually run — this is what proves the bootstrap works.
    expect(sandbox.testRuns).toEqual(['passed']);
  });

  it('returns the manifest + lockfile among the paths to commit', async () => {
    const sandbox = new FakeCodeSandbox(['passed']);
    sandbox.files.set('package.json', JSON.stringify({ name: 'acme' }));

    const result = await runBootstrap(TYPESCRIPT_JAVASCRIPT, 'full', sandbox);

    expect(result.changedPaths).toContain('vitest.config.ts');
    expect(result.changedPaths).toContain('package.json');
    expect(result.changedPaths).toContain('package-lock.json');
    expect(new Set(result.changedPaths).size).toBe(result.changedPaths.length); // no duplicates
  });

  it('does NOT author an example test on the runner-only path', async () => {
    const sandbox = new FakeCodeSandbox(['passed']);
    sandbox.files.set('package.json', JSON.stringify({ name: 'acme' }));

    const result = await runBootstrap(TYPESCRIPT_JAVASCRIPT, 'runner-only', sandbox);

    expect(result.status).toBe('green');
    expect(sandbox.files.has(TYPESCRIPT_JAVASCRIPT.bootstrap!.exampleTest().path)).toBe(false);
    expect(sandbox.files.has('vitest.config.ts')).toBe(true);
  });

  it('reports not-green when the suite fails, so the caller commits nothing', async () => {
    const sandbox = new FakeCodeSandbox(['failed']);

    const result = await runBootstrap(PYTHON, 'full', sandbox);

    expect(result.status).toBe('not-green');
    expect(result.outputTail).toBeTruthy();
  });

  it('reports not-green when the runner install itself fails, without running the suite', async () => {
    const sandbox = new FakeCodeSandbox(['passed']);
    sandbox.setupExitCode = 1;

    const result = await runBootstrap(PYTHON, 'full', sandbox);

    expect(result.status).toBe('not-green');
    expect(sandbox.testRuns).toEqual([]); // never got as far as the suite
  });

  it('reports no-recipe for a pack that has no scaffolding, touching nothing', async () => {
    const sandbox = new FakeCodeSandbox(['passed']);

    const result = await runBootstrap(NO_RECIPE_PACK, 'full', sandbox);

    expect(result.status).toBe('no-recipe');
    expect(sandbox.writes).toEqual([]);
    expect(sandbox.setupCommands).toEqual([]);
  });

  it('writes a python bootstrap that pytest will collect', async () => {
    const sandbox = new FakeCodeSandbox(['passed']);

    const result = await runBootstrap(PYTHON, 'full', sandbox);

    expect(result.status).toBe('green');
    expect(sandbox.files.has('pytest.ini')).toBe(true);
    expect(sandbox.files.has('conftest.py')).toBe(true);
    expect(result.runner).toBe('pytest');
  });
});
