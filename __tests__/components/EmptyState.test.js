import React from 'react';
import { render } from '../helpers/renderWithProviders';
import EmptyState from '../../components/EmptyState';

describe('EmptyState', () => {
  it('renders without crashing', () => {
    expect(() => render(React.createElement(EmptyState))).not.toThrow();
  });

  it('shows the "All clear!" heading', () => {
    const screen = render(React.createElement(EmptyState));
    expect(screen.getByText('All clear!')).toBeTruthy();
  });

  it('shows the + button reference in instruction text', () => {
    const screen = render(React.createElement(EmptyState));
    expect(screen.getByText('+')).toBeTruthy();
  });

  it('shows the tap instruction', () => {
    const screen = render(React.createElement(EmptyState));
    expect(screen.getByText('No assignments yet. Tap the')).toBeTruthy();
  });

  it('renders a View as root element', () => {
    const screen = render(React.createElement(EmptyState));
    expect(screen.toJSON().type).toBe('View');
  });

  describe('variant="noMatches"', () => {
    it('shows the "No matches" heading instead of "All clear!"', () => {
      const screen = render(React.createElement(EmptyState, { variant: 'noMatches', onClear: vi.fn() }));
      expect(screen.getByText('No matches')).toBeTruthy();
      expect(screen.queryByText('All clear!')).toBeNull();
    });

    it('shows a "Clear filters" affordance that calls onClear when tapped', () => {
      const onClear = vi.fn();
      const screen = render(React.createElement(EmptyState, { variant: 'noMatches', onClear }));
      screen.firePressOnText('Clear filters');
      expect(onClear).toHaveBeenCalledOnce();
    });

    it('default (no variant) behavior is unchanged when other props are absent', () => {
      const screen = render(React.createElement(EmptyState));
      expect(screen.getByText('All clear!')).toBeTruthy();
      expect(screen.queryByText('No matches')).toBeNull();
    });
  });
});
