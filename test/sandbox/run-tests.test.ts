import { describe, it, expect } from 'vitest';
import { runTests } from '../../src/sandbox/run-tests.js';
import { FakeSandboxProvider } from './fake-sandbox.js';
import { silentLog } from '../helpers.js';

const input = { token: 'ghs_faketoken', owner: 'acme', repo: 'widgets', ref: 'main' };

describe('runTests', () => {
  it('reports passed when clone, install, and tests all succeed, and tears down', async () => {
    const provider = new FakeSandboxProvider();
    const result = await runTests(input, { sandboxProvider: provider, log: silentLog });

    expect(result.status).toBe('passed');
    expect(result.passed).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(provider.only.killed).toBe(1);
  });

  it('reports failed (not a crash) when the test command exits non-zero, and tears down', async () => {
    const provider = new FakeSandboxProvider([
      { match: 'npm test', result: { exitCode: 1, stdout: '1 failing', stderr: '' } },
    ]);
    const result = await runTests(input, { sandboxProvider: provider, log: silentLog });

    expect(result.status).toBe('failed');
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.failureStage).toBe('test');
    expect(result.outputTail).toContain('1 failing');
    expect(provider.only.killed).toBe(1);
  });

  it('reports an error at the clone stage and does not attempt install/test', async () => {
    const provider = new FakeSandboxProvider([
      { match: 'git clone', result: { exitCode: 128, stdout: '', stderr: 'auth failed' } },
    ]);
    const result = await runTests(input, { sandboxProvider: provider, log: silentLog });

    expect(result.status).toBe('error');
    expect(result.failureStage).toBe('clone');
    expect(provider.only.ranAny('npm ci')).toBe(false);
    expect(provider.only.ranAny('npm test')).toBe(false);
    expect(provider.only.killed).toBe(1);
  });

  it('reports an error at the install stage', async () => {
    const provider = new FakeSandboxProvider([
      { match: 'npm ci', result: { exitCode: 1, stdout: '', stderr: 'install failed' } },
    ]);
    const result = await runTests(input, { sandboxProvider: provider, log: silentLog });

    expect(result.status).toBe('error');
    expect(result.failureStage).toBe('install');
    expect(provider.only.ranAny('npm test')).toBe(false);
    expect(provider.only.killed).toBe(1);
  });

  it('surfaces a mid-run sandbox error cleanly and still tears down', async () => {
    const provider = new FakeSandboxProvider([{ match: 'npm test', throwError: 'sandbox died' }]);
    const result = await runTests(input, { sandboxProvider: provider, log: silentLog });

    expect(result.status).toBe('error');
    expect(result.outputTail).toContain('sandbox died');
    expect(provider.only.killed).toBe(1);
  });

  it('passes the configured timeout to the test command', async () => {
    const provider = new FakeSandboxProvider();
    await runTests(input, { sandboxProvider: provider, log: silentLog, timeoutMs: 1234 });

    const testCmd = provider.only.commands.find((c) => c.cmd.includes('npm test'));
    expect(testCmd?.opts?.timeoutMs).toBe(1234);
  });

  it('never leaks the token into the structured result', async () => {
    const provider = new FakeSandboxProvider([
      { match: 'git clone', result: { exitCode: 128, stdout: '', stderr: 'nope' } },
    ]);
    const result = await runTests(input, { sandboxProvider: provider, log: silentLog });
    expect(JSON.stringify(result)).not.toContain('ghs_faketoken');
  });
});
