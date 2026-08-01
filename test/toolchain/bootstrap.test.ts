import { describe, it, expect } from 'vitest';
import { PYTHON, TYPESCRIPT_JAVASCRIPT, type FileReader } from '../../src/toolchain/toolchain.js';

/** Build a FileReader over a fixed path→content map (files not in the map do not exist). */
function readerFor(files: Record<string, string>): FileReader {
  return async (path: string) => files[path];
}

describe('typescript-javascript bootstrap recipe', () => {
  const recipe = TYPESCRIPT_JAVASCRIPT.bootstrap!;

  it('installs vitest and writes a config the pack already knows how to find', () => {
    expect(recipe.runner).toBe('vitest');
    expect(recipe.addRunnerCmd).toContain('vitest');

    const files = recipe.configFiles(JSON.stringify({ name: 'x' }));
    const config = files.find((f) => f.path === 'vitest.config.ts');
    expect(config).toBeDefined();
    // The config must be one readTestConventions already probes for, or the test-author
    // never sees it and places tests where the runner won't collect them.
    expect(TYPESCRIPT_JAVASCRIPT.testConfigFiles).toContain('vitest.config.ts');
  });

  it('merges the test script into package.json without clobbering what is there', () => {
    const manifest = JSON.stringify(
      { name: 'acme', version: '1.0.0', scripts: { build: 'tsc' }, devDependencies: { typescript: '^5' } },
      null,
      2,
    );
    const pkg = recipe.configFiles(manifest).find((f) => f.path === 'package.json');
    expect(pkg).toBeDefined();

    const parsed = JSON.parse(pkg!.content) as {
      name: string;
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(parsed.scripts.test).toBe('vitest run');
    expect(parsed.scripts.build).toBe('tsc'); // sibling scripts survive
    expect(parsed.name).toBe('acme');
    expect(parsed.devDependencies.typescript).toBe('^5');
  });

  it('leaves package.json alone when the manifest is missing or unparseable', () => {
    expect(recipe.configFiles(undefined).some((f) => f.path === 'package.json')).toBe(false);
    expect(recipe.configFiles('not json {').some((f) => f.path === 'package.json')).toBe(false);
  });

  it('writes an example test the pack recognises as a test file', () => {
    const example = recipe.exampleTest();
    expect(TYPESCRIPT_JAVASCRIPT.isTestFile(example.path)).toBe(true);
    expect(example.content).toContain('vitest');
  });

  it('lists the files `npm install` rewrites so they get committed', () => {
    // `npm install --save-dev vitest` edits package.json + the lockfile in the sandbox; if we
    // don't commit those, the devDependency never lands and CI installs without vitest.
    expect(recipe.installArtifacts).toContain('package.json');
    expect(recipe.installArtifacts).toContain('package-lock.json');
  });
});

describe('python bootstrap recipe', () => {
  const recipe = PYTHON.bootstrap!;

  it('installs pytest and writes a config the pack already knows how to find', () => {
    expect(recipe.runner).toBe('pytest');
    expect(recipe.addRunnerCmd).toContain('pytest');

    const paths = recipe.configFiles().map((f) => f.path);
    expect(paths).toContain('pytest.ini');
    expect(PYTHON.testConfigFiles).toContain('pytest.ini');
  });

  it('writes a root conftest.py that puts the repo root on sys.path', () => {
    // Without this, `import mypkg` from tests/ does not resolve and every generated test is a
    // FALSE red the implementer can never fix (it may not edit tests).
    const conftest = recipe.configFiles().find((f) => f.path === 'conftest.py');
    expect(conftest).toBeDefined();
    expect(conftest!.content).toContain('sys.path');
  });

  it('writes an example test the pack recognises as a test file', () => {
    const example = recipe.exampleTest();
    expect(PYTHON.isTestFile(example.path)).toBe(true);
    expect(example.path.startsWith('tests/')).toBe(true); // matches pytest.ini's testpaths
  });

  it('needs nothing committed back from the install step', () => {
    expect(recipe.installArtifacts).toEqual([]);
  });
});

describe('hasTestRunner — typescript/javascript', () => {
  const tc = TYPESCRIPT_JAVASCRIPT;

  it('is true when a dedicated runner config exists', async () => {
    expect(await tc.hasTestRunner(['vitest.config.ts'], readerFor({}))).toBe(true);
    expect(await tc.hasTestRunner(['jest.config.js'], readerFor({}))).toBe(true);
  });

  it('is true when package.json has a real test script or the runner as a dependency', async () => {
    const withScript = { 'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }) };
    expect(await tc.hasTestRunner(['package.json'], readerFor(withScript))).toBe(true);

    const withDep = { 'package.json': JSON.stringify({ devDependencies: { jest: '^29' } }) };
    expect(await tc.hasTestRunner(['package.json'], readerFor(withDep))).toBe(true);
  });

  it('does NOT count npm\'s placeholder test script', async () => {
    // `npm init` writes this; it exits 1, so treating it as a runner makes the suite look
    // permanently red and the TDD loop can never green.
    const files = {
      'package.json': JSON.stringify({
        scripts: { test: 'echo "Error: no test specified" && exit 1' },
      }),
    };
    expect(await tc.hasTestRunner(['package.json'], readerFor(files))).toBe(false);
  });

  it('does NOT count a vite.config.ts that has no test block', async () => {
    const bundlerOnly = { 'vite.config.ts': `export default { plugins: [] };` };
    expect(await tc.hasTestRunner(['vite.config.ts'], readerFor(bundlerOnly))).toBe(false);

    const withTests = { 'vite.config.ts': `export default { test: { globals: true } };` };
    expect(await tc.hasTestRunner(['vite.config.ts'], readerFor(withTests))).toBe(true);
  });

  it('is false for a bare repo with nothing configured', async () => {
    const files = { 'package.json': JSON.stringify({ name: 'x', scripts: { build: 'tsc' } }) };
    expect(await tc.hasTestRunner(['package.json', 'src/index.ts'], readerFor(files))).toBe(false);
  });
});

describe('hasTestRunner — python', () => {
  it('is true for pytest-specific config or a conftest.py', async () => {
    expect(await PYTHON.hasTestRunner(['pytest.ini'], readerFor({}))).toBe(true);
    expect(await PYTHON.hasTestRunner(['conftest.py'], readerFor({}))).toBe(true);
  });

  it('does NOT treat a bare pyproject.toml as a configured runner', async () => {
    // pyproject.toml is in testConfigFiles and exists in nearly every modern Python repo —
    // presence alone must not read as "pytest is set up", or we never bootstrap anything.
    const bare = { 'pyproject.toml': '[project]\nname = "acme"\n' };
    expect(await PYTHON.hasTestRunner(['pyproject.toml'], readerFor(bare))).toBe(false);

    const configured = { 'pyproject.toml': '[project]\nname = "acme"\n\n[tool.pytest.ini_options]\n' };
    expect(await PYTHON.hasTestRunner(['pyproject.toml'], readerFor(configured))).toBe(true);
  });

  it('reads a pytest section out of setup.cfg / tox.ini', async () => {
    expect(await PYTHON.hasTestRunner(['setup.cfg'], readerFor({ 'setup.cfg': '[tool:pytest]\n' }))).toBe(true);
    expect(await PYTHON.hasTestRunner(['tox.ini'], readerFor({ 'tox.ini': '[testenv]\n' }))).toBe(false);
  });
});
