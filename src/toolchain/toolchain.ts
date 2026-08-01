/**
 * A `Toolchain` is a language "pack": everything that varies between a TypeScript repo and a Python
 * (or Go, Java, …) repo, gathered behind one interface so the sandbox runner, the test-conventions
 * probe, the repo map, the code index and the agent prompts read it instead of hardcoding `npm`.
 *
 * Phase 13a introduces the abstraction and moves the previously-hardcoded TS/JS behaviour behind the
 * single {@link TYPESCRIPT_JAVASCRIPT} pack — a behaviour-neutral refactor. Phase 13b adds the first
 * non-TS pack (Python) and wires per-run selection through the pipeline.
 */
/**
 * Reads a repo-relative file, resolving to `undefined` when it does not exist. Lets the same
 * detection logic run against a host checkout (plan time) and a sandbox checkout (implement time).
 */
export type FileReader = (path: string) => Promise<string | undefined>;

/** A whole file the bootstrap writes into the checkout. */
export interface BootstrapFile {
  path: string;
  content: string;
}

/**
 * How to give a repo with no test setup a minimal working one (Phase 15). Deliberately
 * deterministic — the recipe is a fixed handful of files per language with no variance worth a
 * model call, and the "suite must go green before we commit" gate makes correctness checkable.
 */
export interface BootstrapRecipe {
  /** The test framework installed, e.g. `vitest`. Named at the plan gate and in the PR. */
  runner: string;
  /** Command run in the checkout that adds the runner (needs network). */
  addRunnerCmd: string;
  /**
   * The runner config plus any support files. `manifest` is the current project-manifest content
   * when one exists, so the recipe can **merge** into it rather than clobber it.
   */
  configFiles(manifest?: string): BootstrapFile[];
  /** A trivial always-passing test proving the runner collects and runs something. */
  exampleTest(): BootstrapFile;
  /**
   * Tracked files `addRunnerCmd` rewrites in the checkout (e.g. the manifest + lockfile), which
   * must be committed alongside the recipe's own files or the dependency never lands.
   */
  installArtifacts: string[];
}

export interface Toolchain {
  /** Stable identifier, e.g. `typescript-javascript`. */
  id: string;
  /** Human label for issue comments and logs. */
  displayName: string;
  /** GitHub linguist language names this pack handles, lowercased. */
  languages: string[];
  /** Command that installs dependencies in the checkout root. */
  installCmd: string;
  /** Command that runs the repo's test suite. */
  testCmd: string;
  /**
   * Candidate test-runner config files, in priority order, surfaced to the test-author so it places
   * new tests where the runner will actually collect them.
   */
  testConfigFiles: string[];
  /** The project manifest whose contents describe the project + test script (e.g. `package.json`). */
  projectManifest: string;
  /** Source-file extensions this pack indexes. Keep in sync with the CocoIndex sidecar's SOURCE_EXT. */
  sourceExts: string[];
  /** Optional sandbox template override; unset → the process-level `E2B_TEMPLATE` / base image. */
  sandboxTemplate?: string;
  /**
   * Language-specific guidance injected into the authoring agents' prompts (test-file naming, the
   * test framework, and how imports resolve). Keeps the role instruction files language-neutral so
   * the same agents work across packs — the concrete idioms live here, per language.
   */
  promptConventions: string;
  /** True when a repo with these tracked files is this toolchain's project (a project file present). */
  detect(files: string[]): boolean;
  /** True when `path` is one of this language's test files (so example tests are found correctly). */
  isTestFile(path: string): boolean;
  /**
   * Does this repo already have a **working test runner**? Deliberately stronger than "a file from
   * `testConfigFiles` exists": `pyproject.toml` is in Python's list and is present in nearly every
   * modern Python repo, and npm writes a placeholder `test` script that only ever exits 1. Getting
   * this wrong either bootstraps over a working setup or never bootstraps at all.
   */
  hasTestRunner(files: string[], read: FileReader): Promise<boolean>;
  /** How to scaffold a minimal test setup. Absent → repos with no tests are refused gracefully. */
  bootstrap?: BootstrapRecipe;
}

/** Does `files` contain `name` at the repo root or in any subdirectory? */
function hasFile(files: string[], name: string): boolean {
  return findFile(files, name) !== undefined;
}

/** The first path in `files` matching `name` at the root or in any subdirectory. */
function findFile(files: string[], name: string): string | undefined {
  return files.find((f) => f === name || f.endsWith(`/${name}`));
}

/**
 * `npm init` writes this as the default `test` script. It exits 1, so counting it as a configured
 * runner makes the suite look permanently red and the TDD loop can never observe green.
 */
const NPM_PLACEHOLDER_TEST = /no test specified/i;

/** Read a JSON file through the reader, returning undefined when absent or unparseable. */
async function readJson(
  files: string[],
  name: string,
  read: FileReader,
): Promise<Record<string, unknown> | undefined> {
  const path = findFile(files, name);
  if (!path) return undefined;
  const raw = await read(path);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** True when `name` exists and its contents match `marker` (a section header, typically). */
async function fileMatches(
  files: string[],
  name: string,
  read: FileReader,
  marker: RegExp,
): Promise<boolean> {
  const path = findFile(files, name);
  if (!path) return false;
  const raw = await read(path);
  return raw !== undefined && marker.test(raw);
}

/**
 * The one and only pack for the MVP: TypeScript / JavaScript. Every field here is the exact value
 * that used to be hardcoded across `code-sandbox.ts`, `run-tests.ts`, the `readTestConventions`
 * probe and the sidecar, so routing through it changes nothing.
 */
export const TYPESCRIPT_JAVASCRIPT: Toolchain = {
  id: 'typescript-javascript',
  displayName: 'TypeScript / JavaScript',
  languages: ['typescript', 'javascript'],
  // `npm ci` requires a lockfile that matches package.json exactly and fails hard otherwise —
  // at sandbox open, before anything can recover. Falling back to `npm install` keeps repos with
  // no/stale lockfile usable; it only runs when `npm ci` has already failed.
  installCmd: 'npm ci || npm install',
  testCmd: 'npm test',
  testConfigFiles: [
    'vitest.config.ts',
    'vitest.config.js',
    'vitest.config.mts',
    'vitest.config.mjs',
    'vite.config.ts',
    'vite.config.js',
    'jest.config.ts',
    'jest.config.js',
    'jest.config.cjs',
    'jest.config.mjs',
    'jest.config.json',
  ],
  projectManifest: 'package.json',
  sourceExts: ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'],
  promptConventions:
    '- Test files: `*.test.ts` / `*.spec.ts` (or `.js`/`.tsx`), collected per the runner config — ' +
    'usually a top-level `test/` tree mirroring the source path, or co-located under `src/`.\n' +
    '- Framework: vitest or jest (see the runner config).\n' +
    '- Imports: relative ESM imports, computed from the test file\'s own location. A test at ' +
    '`test/foo.test.ts` imports `src/foo` as `../src/foo`; at `test/sub/foo.test.ts` as `../../src/foo`.',
  detect(files) {
    return hasFile(files, this.projectManifest);
  },
  isTestFile(path) {
    // A JS/TS file in a test dir, or any file with a .test/.spec suffix. The extension guard on the
    // dir branch keeps a shared `tests/` dir from claiming another language's files.
    const inTestDir = /(^|\/)(test|tests|__tests__)\//.test(path) && /\.[cm]?[jt]sx?$/.test(path);
    return inTestDir || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
  },
  async hasTestRunner(files, read) {
    // A dedicated vitest/jest config is conclusive on its own.
    const dedicated = this.testConfigFiles.filter((c) => !c.startsWith('vite.config'));
    if (dedicated.some((c) => hasFile(files, c))) return true;

    // `vite.config.*` is a bundler config; it only means "tests" if it carries a `test:` block.
    for (const c of this.testConfigFiles.filter((c) => c.startsWith('vite.config'))) {
      if (await fileMatches(files, c, read, /\btest\s*:/)) return true;
    }

    const pkg = await readJson(files, this.projectManifest, read);
    if (!pkg) return false;
    const scripts = pkg.scripts as Record<string, string> | undefined;
    const script = scripts?.test;
    if (typeof script === 'string' && script.trim() && !NPM_PLACEHOLDER_TEST.test(script)) return true;
    if (pkg.jest !== undefined) return true; // jest config embedded in package.json
    const deps = {
      ...(pkg.devDependencies as Record<string, string> | undefined),
      ...(pkg.dependencies as Record<string, string> | undefined),
    };
    return deps.vitest !== undefined || deps.jest !== undefined;
  },
  bootstrap: {
    runner: 'vitest',
    // vitest handles TypeScript and ESM with no extra transform config, which is what makes a
    // deterministic recipe viable here — jest would need ts-jest/babel wiring per repo.
    addRunnerCmd: 'npm install --save-dev vitest',
    installArtifacts: ['package.json', 'package-lock.json'],
    configFiles(manifest) {
      const files: BootstrapFile[] = [
        {
          path: 'vitest.config.ts',
          // vitest's own defaults, written out explicitly: this can never collect *less* than the
          // zero-config default, and it gives `readTestConventions` something concrete to show the
          // test-author so it places files where the runner looks.
          content: [
            "import { defineConfig } from 'vitest/config';",
            '',
            '// Added by Tsukinome: this repo had no test runner configured.',
            'export default defineConfig({',
            '  test: {',
            "    include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'],",
            "    exclude: ['**/node_modules/**', '**/dist/**', '**/build/**'],",
            '  },',
            '});',
            '',
          ].join('\n'),
        },
      ];
      // Merge the test script into the existing manifest rather than writing a fresh one, so the
      // repo's own scripts/deps survive. No manifest (or an unparseable one) → leave it alone.
      if (manifest !== undefined) {
        try {
          const pkg = JSON.parse(manifest) as Record<string, unknown>;
          const scripts = { ...(pkg.scripts as Record<string, string> | undefined) };
          scripts.test = 'vitest run';
          files.push({
            path: 'package.json',
            content: `${JSON.stringify({ ...pkg, scripts }, null, 2)}\n`,
          });
        } catch {
          // Unparseable manifest — npm would fail on it anyway; the green gate will catch it.
        }
      }
      return files;
    },
    exampleTest() {
      return {
        path: 'test/tsukinome-setup.test.ts',
        content: [
          "import { describe, it, expect } from 'vitest';",
          '',
          '// Added by Tsukinome when this repo had no test setup. It proves the runner is wired',
          '// up correctly — safe to delete once you have tests of your own.',
          "describe('test setup', () => {",
          "  it('runs', () => {",
          '    expect(true).toBe(true);',
          '  });',
          '});',
          '',
        ].join('\n'),
      };
    },
  },
};

/**
 * Python pack: pytest over pip. The install command is best-effort across the common project shapes
 * (editable install if there's a build config, else `requirements.txt`) and always ensures pytest is
 * present, since `testCmd` is `pytest`. The sandbox image must carry a Python runtime (see docs/setup).
 */
export const PYTHON: Toolchain = {
  id: 'python',
  displayName: 'Python',
  languages: ['python'],
  installCmd:
    'python -m pip install --quiet --upgrade pip && ' +
    '(pip install --quiet -e . || pip install --quiet -r requirements.txt || true) && ' +
    'pip install --quiet pytest',
  testCmd: 'pytest',
  testConfigFiles: ['pyproject.toml', 'pytest.ini', 'tox.ini', 'setup.cfg', 'conftest.py'],
  projectManifest: 'pyproject.toml',
  sourceExts: ['.py'],
  promptConventions:
    '- Test files: `test_*.py` or `*_test.py`, collected by pytest — usually under a `tests/` ' +
    'directory or alongside the module under test.\n' +
    '- Framework: pytest with plain `assert` statements (no test classes required).\n' +
    '- Imports: import the module under test by its package/module path exactly as the repo\'s ' +
    'existing tests do (e.g. `from mypkg.foo import bar`, or `import foo` for a flat layout). Match ' +
    'the example test files\' import style — do not invent a package path that does not exist.',
  detect(files) {
    return (
      hasFile(files, 'pyproject.toml') ||
      hasFile(files, 'setup.py') ||
      hasFile(files, 'setup.cfg') ||
      hasFile(files, 'requirements.txt')
    );
  },
  isTestFile(path) {
    return (
      (/(^|\/)tests?\//.test(path) && path.endsWith('.py')) ||
      /(^|\/)test_[^/]*\.py$/.test(path) ||
      /_test\.py$/.test(path) ||
      /(^|\/)conftest\.py$/.test(path)
    );
  },
  async hasTestRunner(files, read) {
    // pytest-only artifacts are conclusive by their existence.
    if (hasFile(files, 'pytest.ini') || hasFile(files, 'conftest.py')) return true;
    // The shared config files only count when they actually carry a pytest section — a bare
    // pyproject.toml exists in nearly every Python repo and says nothing about tests.
    return (
      (await fileMatches(files, 'pyproject.toml', read, /\[tool\.pytest/)) ||
      (await fileMatches(files, 'setup.cfg', read, /\[tool:pytest\]/)) ||
      (await fileMatches(files, 'tox.ini', read, /\[(pytest|tool:pytest)\]/))
    );
  },
  bootstrap: {
    runner: 'pytest',
    addRunnerCmd: 'python -m pip install --quiet pytest',
    // pip installs into the environment, not the checkout — nothing tracked to commit back.
    installArtifacts: [],
    configFiles() {
      return [
        {
          path: 'pytest.ini',
          content: ['[pytest]', '# Added by Tsukinome: this repo had no test runner configured.', 'testpaths = tests', ''].join('\n'),
        },
        {
          path: 'conftest.py',
          // Load-bearing: without the repo root on sys.path, `import mypkg` from tests/ does not
          // resolve, and every generated test is a FALSE red the implementer can never fix
          // (it may not edit tests). Explicit beats relying on pytest's rootdir inference.
          content: [
            '"""Added by Tsukinome: makes the repo root importable from tests."""',
            '',
            'import sys',
            'from pathlib import Path',
            '',
            'sys.path.insert(0, str(Path(__file__).parent))',
            '',
          ].join('\n'),
        },
      ];
    },
    exampleTest() {
      return {
        path: 'tests/test_tsukinome_setup.py',
        content: [
          '"""Added by Tsukinome when this repo had no test setup.',
          '',
          'It proves pytest collects and runs — safe to delete once you have tests of your own.',
          '"""',
          '',
          '',
          'def test_setup_runs():',
          '    assert True',
          '',
        ].join('\n'),
      };
    },
  },
};

/** Every registered language pack. Add a pack here to make it selectable. */
export const TOOLCHAINS: readonly Toolchain[] = [TYPESCRIPT_JAVASCRIPT, PYTHON];

/** Used when a repo's language can't be determined — preserves the old "null language → proceed". */
export const DEFAULT_TOOLCHAIN: Toolchain = TYPESCRIPT_JAVASCRIPT;

/**
 * Resolve a pack from a GitHub-detected primary language. A blank/unknown language returns the
 * default (we can't tell → proceed, matching the pre-13a gate); a known-but-unsupported language
 * returns `undefined` so the caller refuses gracefully.
 */
export function toolchainForLanguage(language: string | null | undefined): Toolchain | undefined {
  if (language == null || language.trim() === '') return DEFAULT_TOOLCHAIN;
  const lc = language.toLowerCase();
  return TOOLCHAINS.find((t) => t.languages.includes(lc));
}

/**
 * Resolve a pack from the repo's actual tracked files (manifest presence). Content-based detection
 * is more reliable than GitHub's byte-count primary language for polyglot repos; returns `undefined`
 * when no pack's project files are present.
 */
export function detectToolchain(files: string[]): Toolchain | undefined {
  return TOOLCHAINS.find((t) => t.detect(files));
}

/** Resolve a pack from its stored `id` (persisted on the run so later phases reload the same pack). */
export function toolchainById(id: string | null | undefined): Toolchain | undefined {
  if (!id) return undefined;
  return TOOLCHAINS.find((t) => t.id === id);
}
