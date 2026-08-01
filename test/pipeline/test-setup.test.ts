import { describe, it, expect } from 'vitest';
import { detectTestSetup, renderTestSetupNote } from '../../src/pipeline/test-setup.js';
import { PYTHON, TYPESCRIPT_JAVASCRIPT, type FileReader } from '../../src/toolchain/toolchain.js';

function readerFor(files: Record<string, string>): FileReader {
  return async (path: string) => files[path];
}

const PKG_NO_TESTS = JSON.stringify({ name: 'acme', scripts: { build: 'tsc' } });

describe('detectTestSetup', () => {
  it('leaves a repo that already has a runner completely alone', async () => {
    const files = ['package.json', 'vitest.config.ts', 'src/a.ts', 'test/a.test.ts'];
    const verdict = await detectTestSetup(TYPESCRIPT_JAVASCRIPT, files, readerFor({}));

    expect(verdict.hasRunner).toBe(true);
    expect(verdict.hasTests).toBe(true);
    expect(verdict.action).toBe('none');
  });

  it('takes no action when a runner is configured but no tests exist yet', async () => {
    // The test-author writes the first test, so there is a test file by the time the suite
    // runs — nothing to bootstrap.
    const files = ['package.json', 'vitest.config.ts', 'src/a.ts'];
    const verdict = await detectTestSetup(TYPESCRIPT_JAVASCRIPT, files, readerFor({}));

    expect(verdict.hasRunner).toBe(true);
    expect(verdict.hasTests).toBe(false);
    expect(verdict.action).toBe('none');
  });

  it('asks for a full bootstrap when there is no runner and no tests', async () => {
    const files = ['package.json', 'src/a.ts', 'README.md'];
    const verdict = await detectTestSetup(
      TYPESCRIPT_JAVASCRIPT,
      files,
      readerFor({ 'package.json': PKG_NO_TESTS }),
    );

    expect(verdict.hasRunner).toBe(false);
    expect(verdict.hasTests).toBe(false);
    expect(verdict.action).toBe('full');
    expect(verdict.reason).toBeTruthy();
  });

  it('asks for runner-only when tests exist but nothing runs them', async () => {
    // Their tests are the tests: we add the runner, never author an example, never edit theirs.
    const files = ['package.json', 'src/a.ts', 'test/a.test.ts'];
    const verdict = await detectTestSetup(
      TYPESCRIPT_JAVASCRIPT,
      files,
      readerFor({ 'package.json': PKG_NO_TESTS }),
    );

    expect(verdict.hasRunner).toBe(false);
    expect(verdict.hasTests).toBe(true);
    expect(verdict.action).toBe('runner-only');
  });

  it('treats npm\'s placeholder test script as no runner at all', async () => {
    const files = ['package.json', 'src/a.ts'];
    const placeholder = JSON.stringify({
      scripts: { test: 'echo "Error: no test specified" && exit 1' },
    });
    const verdict = await detectTestSetup(TYPESCRIPT_JAVASCRIPT, files, readerFor({ 'package.json': placeholder }));

    expect(verdict.action).toBe('full');
  });

  it('bootstraps a Python repo whose pyproject.toml has no pytest section', async () => {
    const files = ['pyproject.toml', 'acme/__init__.py', 'acme/core.py'];
    const verdict = await detectTestSetup(
      PYTHON,
      files,
      readerFor({ 'pyproject.toml': '[project]\nname = "acme"\n' }),
    );

    expect(verdict.hasRunner).toBe(false);
    expect(verdict.action).toBe('full');
  });

  it('leaves a Python repo with pytest configured alone', async () => {
    const files = ['pyproject.toml', 'pytest.ini', 'tests/test_core.py'];
    const verdict = await detectTestSetup(PYTHON, files, readerFor({}));

    expect(verdict.action).toBe('none');
  });
});

describe('renderTestSetupNote', () => {
  it('names the runner and says the setup is a separate commit', () => {
    const planned = renderTestSetupNote({ runner: 'vitest', action: 'full' }, 'planned');
    expect(planned).toContain('vitest');
    expect(planned.toLowerCase()).toContain('commit');

    const done = renderTestSetupNote({ runner: 'pytest', action: 'full' }, 'done');
    expect(done).toContain('pytest');
  });

  it('says existing tests are untouched on the runner-only path', () => {
    const note = renderTestSetupNote({ runner: 'vitest', action: 'runner-only' }, 'planned');
    expect(note.toLowerCase()).toContain('existing test');
  });
});
