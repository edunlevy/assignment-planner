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
});
