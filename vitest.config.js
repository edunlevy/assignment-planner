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

// createRequire is cheap (no module loading) — safe at top level.
const _require = createRequire(import.meta.url);

// JSX-containing source files: components/*.js, screens/*.js, App.js.
// hooks/ and lib/ are excluded — they are plain JS with no JSX syntax.
// `*.styles.js` sit under components/ but hold only StyleSheet objects (no
// JSX), so they're excluded to avoid running babel on them needlessly.
const JSX_FILE_RE = /\/(components|screens)\/[^/]+\.js$|\/App\.js$/;
function isJsxFile(file) {
  return JSX_FILE_RE.test(file) && !file.endsWith('.styles.js');
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
          // Emit a source map so the v8 coverage provider can attribute
          // executed, JSX-transformed code back to the ORIGINAL .js source.
          // Without this the previous plugin left UI files un-remappable, which
          // is why components/screens/App.js could not be line-counted at all.
          sourceMaps: true,
          ast: false,
        });
        if (!r) return null;
        return { code: r.code, map: r.map };
      } catch {
        return null;
      }
    };
  }
  return _transformJSX(code, filename);
}

// Vite plugin: strip JSX from React Native .js component/screen files (and
// App.js) IN PLACE, keyed on the file's REAL id — no virtual `\0jsx:` module.
//
// Why a real-id `transform` hook (not the old resolveId/load virtual-ID trick):
//   The v8 coverage provider attributes execution by real file path + source
//   map. The old plugin served the transformed code from a virtual `\0jsx:`
//   id with no source map, so the coverage provider — which reads the REAL
//   files from disk — saw raw, unparseable JSX and could not count UI files
//   at all (they ran but were invisible to coverage). Transforming under the
//   real id and emitting a source map lets v8 map executed code straight back
//   to the original .js, so components/, screens/, and App.js are now counted.
//   `enforce: 'pre'` runs this before vite's esbuild/import-analysis, so those
//   stages only ever see the emitted plain JS.
const rnJsxPlugin = {
  name: 'rn-jsx-in-js',
  enforce: 'pre',
  transform(code, id) {
    // id may carry a query suffix (?v=...); match on the path part only.
    const file = id.split('?')[0];
    if (file.includes('node_modules')) return null;
    if (!isJsxFile(file)) return null;
    return transformJSX(code, file);
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
    // include now covers the WHOLE app — lib/, hooks/, components/, screens/,
    // and App.js. UI files became line-countable once the rnJsxPlugin above
    // switched to a real-id transform that emits a source map (see its comment):
    // the v8 provider can finally attribute executed JSX back to the original
    // .js. The historical ~0% CPU hang doesn't recur because the v8
    // uncovered-file scan runs each included file back through the Vite
    // transform pipeline (so rnJsxPlugin strips its JSX) BEFORE parsing it —
    // even a UI file that no test imports parses fine. The exclude list keeps
    // the scan off non-app trees (marketing/, web-redirect/, scripts/, db/) and
    // presentational style-only files.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['lib/**/*.js', 'hooks/**/*.js', 'components/**/*.js', 'screens/**/*.js', 'App.js'],
      exclude: ['**/__tests__/**', '**/*.test.js', '**/*.styles.js'],
      // Thresholds are a whole-app floor plus per-area floors, all set
      // just-below current actuals (2026-07, with UI now counted):
      //   all files  — lines 90.35 / statements 88.30 / functions 82.63 / branches 82.09
      //   lib/**     — lines 93.98 / branches 91.36
      //   hooks/**   — lines 96.75 / branches 80.11 (useAssignments branch is the low point)
      // The whole-app number is LOWER than the old lib+hooks-only figure not
      // because coverage regressed but because the denominator now includes the
      // UI and App.js (~51% lines) — a known Phase-1 gap the flow/UI tests will
      // ratchet up. The lib/ and hooks/ per-globs preserve the mature core's
      // high bar so it can't silently regress while UI coverage is climbing.
      thresholds: {
        lines: 89,
        statements: 87,
        functions: 81,
        branches: 80,
        'lib/**': { lines: 92, statements: 91, functions: 92, branches: 88 },
        'hooks/**': { lines: 95, statements: 91, functions: 88, branches: 79 },
      },
    },
  },
});
