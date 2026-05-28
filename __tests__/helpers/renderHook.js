// Minimal renderHook helper for testing React hooks in this project.
//
// Why custom (vs @testing-library/react)?
//   - vitest is configured with environment: 'node' (no DOM)
//   - @testing-library/react requires jsdom / happy-dom
//   - react-test-renderer is already installed and works DOM-less
//   - This helper is ~25 lines; the dependency it would replace is huge
//
// Usage:
//   import { renderHook, flushMicrotasks } from '../helpers/renderHook';
//   import { act } from 'react-test-renderer';
//
//   const { result } = renderHook(() => useMyHook('arg'));
//   await flushMicrotasks();           // let load effects settle
//   await act(async () => {
//     await result.current.someMutation();
//   });
//   expect(result.current.value).toBe(...);
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

// Render a hook in isolation. The hook's return value is exposed via
// `result.current`, which is re-read on every render.
export function renderHook(callback) {
  const result = { current: null };
  function TestComponent() {
    result.current = callback();
    return null;
  }
  let renderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(TestComponent));
  });
  return {
    result,
    rerender: () => act(() => renderer.update(React.createElement(TestComponent))),
    unmount: () => act(() => renderer.unmount()),
  };
}

// Drain the microtask queue so chained awaits inside useEffect settle.
// useAssignments' load effect awaits 3–5 promises in sequence (cache read →
// dbFetch → reminder map load → permission check → reminder schedule), so a
// single Promise.resolve() flush is insufficient. Wrapping in act() also
// suppresses the "act warning" for state updates that happen as the
// microtasks drain.
export async function flushMicrotasks(iterations = 10) {
  await act(async () => {
    for (let i = 0; i < iterations; i++) {
      await Promise.resolve();
    }
  });
}
