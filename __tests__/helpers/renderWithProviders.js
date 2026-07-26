// Component render helper for tests.
//
// Why react-test-renderer instead of @testing-library/react-native?
//   - vitest is configured with environment: 'node' (no DOM, no native layer)
//   - @testing-library/react-native pulls in react-native internals whose
//     Flow/TS source isn't processed by vitest's transform pipeline
//   - react-test-renderer is DOM-less and already used by renderHook.js
//
// API mirrors the parts of @testing-library/react-native that component tests
// actually need: render(), getByText(), queryByText(), getByTestId().
//
// Usage:
//   import { render } from '../helpers/renderWithProviders';
//   const screen = render(React.createElement(MyComponent, { prop: 'val' }));
//   expect(screen.getByText('hello')).toBeTruthy();
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

// Recursively walk a react-test-renderer tree node. Handles an ARRAY root too:
// a component whose root is a fragment renders as an array of nodes, and
// without this the walk would visit nothing (arrays have no .type/.children),
// making queries silently "find nothing" instead of matching.
function walk(node, visitor) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const child of node) {
      if (child && typeof child === 'object') walk(child, visitor);
    }
    return;
  }
  visitor(node);
  if (node.children) {
    for (const child of node.children) {
      if (typeof child === 'object') walk(child, visitor);
    }
  }
}

// Find all nodes matching predicate.
function findAll(root, predicate) {
  const matches = [];
  walk(root, node => { if (predicate(node)) matches.push(node); });
  return matches;
}

// Collect all leaf text from a node by concatenating strings and stringifying numbers.
// Used to match text that spans multiple JSX children (e.g. "Importance {n}/5").
function collectText(node) {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (!node || !node.children) return '';
  return node.children.map(collectText).join('');
}

function hasText(node, text) {
  if (typeof node === 'string') return node === text;
  if (typeof node === 'number') return String(node) === text;
  if (!node || !node.children) return false;
  // Check if any direct child matches, or if the node's full text matches.
  return (
    node.children.some(child => hasText(child, text)) ||
    collectText(node) === text
  );
}

function buildScreen(renderer) {
  const getRoot = () => renderer.toJSON();

  return {
    // Return the raw JSON tree (for assertions like toMatchSnapshot or manual checks).
    toJSON: () => getRoot(),

    // Find the first node whose text content matches. Throws if not found.
    getByText(text) {
      const root = getRoot();
      const results = findAll(root, node => hasText(node, text));
      if (results.length === 0) throw new Error(`Unable to find element with text: "${text}"`);
      return results[0];
    },

    // Like getByText but returns null instead of throwing.
    queryByText(text) {
      try { return this.getByText(text); }
      catch { return null; }
    },

    // Find by testID prop (React Native's equivalent of data-testid).
    getByTestId(testId) {
      const root = getRoot();
      const results = findAll(root, node => node.props && node.props.testID === testId);
      if (results.length === 0) throw new Error(`Unable to find element with testID: "${testId}"`);
      return results[0];
    },

    queryByTestId(testId) {
      try { return this.getByTestId(testId); }
      catch { return null; }
    },

    // Find all nodes of a given component type string (e.g. 'View', 'Text').
    getAllByType(type) {
      const root = getRoot();
      return findAll(root, node => node.type === type);
    },

    // Simulate a press on the first node matching testID.
    firePress(testId) {
      const node = this.getByTestId(testId);
      act(() => { node.props.onPress && node.props.onPress(); });
    },

    // Find the first Pressable whose concatenated text matches (or contains) `text`
    // and fire its onPress. Use this when there's no testID on the button.
    firePressOnText(text) {
      const root = getRoot();
      let target = null;
      walk(root, node => {
        if (!target && node.type === 'Pressable') {
          const full = collectText(node);
          if (full === text || full.includes(text)) target = node;
        }
      });
      if (!target) throw new Error(`No Pressable found containing text: "${text}"`);
      act(() => { target.props.onPress && target.props.onPress(); });
    },

    // Flush pending effects / microtasks (useful after rendering hooks-heavy components).
    async flush(iterations = 10) {
      await act(async () => {
        for (let i = 0; i < iterations; i++) await Promise.resolve();
      });
    },

    unmount: () => act(() => renderer.unmount()),
    rerender: (ui) => act(() => renderer.update(ui)),
  };
}

// Thin SafeAreaProvider wrapper — the real package is mocked in jest.setup.js
// to be a passthrough, so this just satisfies components that expect the provider.
function Providers({ children }) {
  return children;
}

export function render(ui) {
  let renderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(Providers, null, ui));
  });
  return buildScreen(renderer);
}

// Re-export act so callers don't need a separate import.
export { act };
