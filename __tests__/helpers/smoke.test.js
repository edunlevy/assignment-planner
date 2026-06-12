// Smoke tests: confirms renderWithProviders and makeAssignment work correctly
// before any component tests depend on them.
import React from 'react';
import { render } from './renderWithProviders';
import { makeAssignment, resetAssignmentCounter } from './mockAssignment';

beforeEach(() => {
  resetAssignmentCounter();
});

describe('renderWithProviders', () => {
  it('renders a Text node without crashing', () => {
    const screen = render(React.createElement('Text', null, 'hello world'));
    expect(screen.getByText('hello world')).toBeTruthy();
  });

  it('queryByText returns null when text is not found', () => {
    const screen = render(React.createElement('Text', null, 'present'));
    expect(screen.queryByText('absent')).toBeNull();
  });

  it('getByText throws when text is not found', () => {
    const screen = render(React.createElement('Text', null, 'present'));
    expect(() => screen.getByText('absent')).toThrow(/Unable to find element with text/);
  });

  it('getByTestId finds a node by testID prop', () => {
    const screen = render(
      React.createElement('View', { testID: 'my-view' },
        React.createElement('Text', null, 'content')
      )
    );
    expect(screen.getByTestId('my-view')).toBeTruthy();
  });

  it('queryByTestId returns null when testID is not found', () => {
    const screen = render(React.createElement('View', { testID: 'existing' }));
    expect(screen.queryByTestId('missing')).toBeNull();
  });

  it('getAllByType finds all nodes of a given type', () => {
    const screen = render(
      React.createElement('View', null,
        React.createElement('Text', null, 'a'),
        React.createElement('Text', null, 'b'),
      )
    );
    const texts = screen.getAllByType('Text');
    expect(texts).toHaveLength(2);
  });
});

describe('makeAssignment', () => {
  it('returns a valid assignment with defaults', () => {
    const a = makeAssignment();
    expect(a.id).toBe('test-id-1');
    expect(a.title).toBe('Test Assignment 1');
    expect(a.course).toBe('CS101');
    expect(a.dueDate).toBe('2026-06-15');
    expect(a.dueTime).toBeNull();
    expect(a.importance).toBe(3);
    expect(a.complexity).toBe('medium');
    expect(a.status).toBe('not_started');
    expect(a.seriesId).toBeNull();
    expect(a.reminderIds).toEqual([]);
  });

  it('applies overrides', () => {
    const a = makeAssignment({ title: 'Midterm', importance: 5, dueTime: '14:00' });
    expect(a.title).toBe('Midterm');
    expect(a.importance).toBe(5);
    expect(a.dueTime).toBe('14:00');
    expect(a.course).toBe('CS101');
  });

  it('increments IDs across calls', () => {
    const a1 = makeAssignment();
    const a2 = makeAssignment();
    expect(a1.id).toBe('test-id-1');
    expect(a2.id).toBe('test-id-2');
  });

  it('resets counter on resetAssignmentCounter()', () => {
    makeAssignment();
    makeAssignment();
    resetAssignmentCounter();
    const a = makeAssignment();
    expect(a.id).toBe('test-id-1');
  });
});
