// Vitest compatibility shim loaded first in setupFiles.
// Provides `jest` as a global alias for `vi` so that jest.mock(),
// jest.fn(), jest.spyOn() etc. in existing test files and jest.setup.js
// all resolve to vitest's native vi API without touching any test files.
globalThis.jest = vi;

// Tell React we're in a test environment that drives updates through act().
// react-test-renderer's act() checks this flag; without it every render/update
// logs "The current testing environment is not configured to support act(...)".
// Our render/renderHook helpers wrap mounts + interactions in act(), so setting
// it is the correct configuration. Safe under isolate:true — each test file
// gets a fresh context, so there's no cross-file flag bleed (see the header
// note in vitest.config.js).
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
