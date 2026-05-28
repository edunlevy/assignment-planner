// Test runner: Vitest (not Jest).
// Jest 29 + Node 22/24 has a cold-start incompatibility that makes it hang
// before printing any output. The jest package is kept as a devDependency
// only because jest.setup.js uses its mock API (aliased to vi via
// vitest.setup.compat.js). Do not add a `test:jest` script — it will hang.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Keep local cache directory consistent with the old jest config.
  cacheDir: '.vitest-cache',
  test: {
    // Make describe/test/expect/vi available as globals so test files need
    // no imports and match jest's existing API surface.
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.compat.js', './jest.setup.js'],
    include: ['**/__tests__/**/*.test.js'],
  },
});
