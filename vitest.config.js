// Test runner: Vitest (not Jest).
// Jest 29 + Node 22/24 has a cold-start incompatibility that makes it hang
// before printing any output. The jest package is kept as a devDependency
// only because jest.setup.js uses its mock API (aliased to vi via
// vitest.setup.compat.js). Do not add a `test:jest` script — it will hang.
//
// forks.singleFork — required on Node 22+/24. Vitest's worker POOL hangs
// during the handshake phase on Node 22+ when it spawns multiple workers, so
// we pin everything to a single fork. isolate:true (per-file module isolation)
// works fine within that single fork and is REQUIRED for correctness: without
// it (isolate:false) every test file shares one module registry, mock set, and
// in-memory AsyncStorage, and under the slower coverage build one file's
// still-in-flight async (a hook's reminder scheduling) bleeds into the next
// file — corrupting its mocks and, via react-test-renderer's act save/restore
// of the shared IS_REACT_ACT_ENVIRONMENT flag, silently disabling effect
// flushing for whole files. That made `npm run test:ci` fail ~1-in-3 runs.
// isolate:true gives each file a fresh context and eliminates the race; the
// single-fork run stays ~2-3s, so the isolation cost is negligible here.

import { defineConfig } from 'vitest/config';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';

// createRequire is cheap (no module loading) — safe at top level.
const _require = createRequire(import.meta.url);

// JSX-containing directories. hooks/ is intentionally excluded — hooks are
// plain JS with no JSX syntax.
const JSX_FILE_RE = /\/(components|screens)\/[^/]+\.js$|\/App\.js$/;

// Strip the '\0jsx:' prefix (5 chars) and '.jsx' suffix (4 chars).
function realPath(id) {
  return id.slice(5, -4);
}

function resolveToAbs(source, importer) {
  // Importer may be a virtual ID; strip prefix to get the real file path.
  const base = importer.startsWith('\0jsx:') ? realPath(importer) : importer;
  const abs = path.resolve(path.dirname(base), source);
  if (abs.endsWith('.js') && fs.existsSync(abs)) return abs;
  const withJs = abs + '.js';
  if (fs.existsSync(withJs)) return withJs;
  return null;
}

// @babel/core is loaded lazily — only when the first JSX file is encountered,
// not during config initialization. This avoids loading a heavy module in
// every worker before any test has run.
let _transformJSX = null;
function transformJSX(code, filename) {
  if (!_transformJSX) {
    const babel = _require('@babel/core');
    const plugin = _require.resolve('@babel/plugin-transform-react-jsx');
    _transformJSX = (src, file) => {
      try {
        const r = babel.transformSync(src, {
          filename: file,
          plugins: [[plugin, { runtime: 'automatic' }]],
          configFile: false,
          babelrc: false,
          sourceMaps: false,
          ast: false,
        });
        return r ? r.code : src;
      } catch { return src; }
    };
  }
  return _transformJSX(code, filename);
}

// Vite plugin: redirect React Native .js component files to virtual .jsx IDs
// so that the JSX content is transformed (via babel, lazily loaded) before
// vite:import-analysis sees it. Without this, import-analysis fails because
// it expects plain JS in .js files.
const rnJsxPlugin = {
  name: 'rn-jsx-in-js',
  enforce: 'pre',
  resolveId(source, importer) {
    if (!importer || source.startsWith('\0') || path.isAbsolute(source)) return null;

    const abs = resolveToAbs(source, importer);
    if (!abs || abs.includes('node_modules')) return null;

    if (JSX_FILE_RE.test(abs)) {
      // Redirect JSX file to a virtual .jsx ID.
      return '\0jsx:' + abs + '.jsx';
    }

    if (importer.startsWith('\0jsx:')) {
      // A virtual module is importing a non-JSX file (e.g. a lib utility).
      // Vite can't resolve relative imports from virtual IDs, so return the
      // real absolute path so Vite's normal load pipeline handles it.
      return abs;
    }

    return null;
  },
  load(id) {
    if (!id.startsWith('\0jsx:')) return null;
    const file = realPath(id);
    try {
      const src = fs.readFileSync(file, 'utf-8');
      // Transform JSX here (before vite:import-analysis) so the plugin
      // returns plain JS that the analysis plugin can parse correctly.
      return { code: transformJSX(src, file) };
    } catch { return null; }
  },
};

export default defineConfig({
  plugins: [rnJsxPlugin],
  cacheDir: '.vitest-cache',
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.compat.js', './jest.setup.js'],
    include: ['**/__tests__/**/*.test.js'],
    // Per-file isolation (see the header note) — required for a reliable
    // coverage run; the single-fork constraint above still avoids the worker
    // handshake hang.
    isolate: true,
    // Single-worker execution (see the header note on the Node 22+ multi-worker
    // handshake hang). Vitest 4 REMOVED the old `poolOptions.forks.singleFork`
    // knob — it is silently ignored, so the default 7-worker fork pool spawns
    // and hangs during the handshake under load. The v4 replacement is
    // `fileParallelism: false`, which forces maxWorkers to 1: all test files run
    // serially in one fork. isolate:true still gives each file a fresh context.
    pool: 'forks',
    fileParallelism: false,

    // Coverage (used by `npm run test:ci` = `vitest run --coverage`).
    //
    // WHY include is restricted to lib/ + hooks/:
    //   The v8 provider's getCoverageMapForUncoveredFiles() reads every file
    //   matched by `coverage.include` and re-parses it with rolldown to build
    //   zero-coverage maps. With the default include (`**`) on Node 22+ under
    //   singleFork this scan hangs at ~0% CPU. Two compounding causes:
    //     1. The JSX component/screen .js files (and App.js) are NOT valid
    //        plain JS — rolldown can't parse the raw JSX, so they can't be
    //        instrumented via v8 anyway (the rnJsxPlugin's virtual `\0jsx:`
    //        transform is invisible to the coverage provider, which reads the
    //        real files from disk). They report 0% / unparseable.
    //     2. The broad uncovered-file scan walks marketing/, web-redirect/,
    //        scripts/, db/, etc. and stalls.
    //   Restricting include to the pure-JS source (lib/, hooks/) avoids both:
    //   the scan stays small and every included file is parseable. plain
    //   `npm test` (no --coverage) is unaffected and stays sub-2s.
    //
    //   components/, screens/, and App.js are therefore NOT gated by v8
    //   coverage here. Their tests still run (and pass); they're just not
    //   line-counted. Re-enabling them needs a coverage-aware JSX transform
    //   (Phase 2 work — see stabilization plan).
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['lib/**/*.js', 'hooks/**/*.js'],
      exclude: ['**/__tests__/**', '**/*.test.js'],
      // Thresholds set at/just below current actuals (lib+hooks, 2026-06):
      //   lines 93.19 / statements 90.07 / functions 89.20 / branches 84.09.
      // Margins leave room for noise while still catching real regressions.
      // branches is set lowest because hooks/useAssignments.js sits at ~73%
      // branch — a known gap Phase 2 will close.
      thresholds: {
        lines: 90,
        statements: 88,
        functions: 86,
        branches: 80,
      },
    },
  },
});
