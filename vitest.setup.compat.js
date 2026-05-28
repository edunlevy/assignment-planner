// Vitest compatibility shim loaded first in setupFiles.
// Provides `jest` as a global alias for `vi` so that jest.mock(),
// jest.fn(), jest.spyOn() etc. in existing test files and jest.setup.js
// all resolve to vitest's native vi API without touching any test files.
globalThis.jest = vi;
