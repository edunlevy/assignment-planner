import React from 'react';
import { render } from '../helpers/renderWithProviders';
import { emptyFilters } from '../../lib/filtering';
import FilterBar from '../../components/FilterBar';

const COURSES = ['CS101', 'MATH201'];

describe('FilterBar', () => {
  it('renders without crashing', () => {
    expect(() => render(React.createElement(FilterBar, {
      filters: emptyFilters(),
      courses: COURSES,
      onChange: vi.fn(),
    }))).not.toThrow();
  });

  it('renders the four due-range chips', () => {
    const screen = render(React.createElement(FilterBar, {
      filters: emptyFilters(),
      courses: COURSES,
      onChange: vi.fn(),
    }));
    expect(screen.getByText('All')).toBeTruthy();
    expect(screen.getByText('Overdue')).toBeTruthy();
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('This week')).toBeTruthy();
  });

  it('renders one chip per distinct course', () => {
    const screen = render(React.createElement(FilterBar, {
      filters: emptyFilters(),
      courses: COURSES,
      onChange: vi.fn(),
    }));
    expect(screen.getByText('CS101')).toBeTruthy();
    expect(screen.getByText('MATH201')).toBeTruthy();
  });

  it('renders the three complexity chips', () => {
    const screen = render(React.createElement(FilterBar, {
      filters: emptyFilters(),
      courses: COURSES,
      onChange: vi.fn(),
    }));
    expect(screen.getByText('Short')).toBeTruthy();
    expect(screen.getByText('Medium')).toBeTruthy();
    expect(screen.getByText('Long')).toBeTruthy();
  });

  describe('Clear chip visibility', () => {
    it('is not rendered when no filters are active', () => {
      const screen = render(React.createElement(FilterBar, {
        filters: emptyFilters(),
        courses: COURSES,
        onChange: vi.fn(),
      }));
      expect(screen.queryByText('Clear')).toBeNull();
    });

    it('is rendered once a course filter is active', () => {
      const screen = render(React.createElement(FilterBar, {
        filters: { courses: ['CS101'], due: 'all', complexity: [] },
        courses: COURSES,
        onChange: vi.fn(),
      }));
      expect(screen.getByText('Clear')).toBeTruthy();
    });

    it('is rendered once a due filter is active', () => {
      const screen = render(React.createElement(FilterBar, {
        filters: { courses: [], due: 'today', complexity: [] },
        courses: COURSES,
        onChange: vi.fn(),
      }));
      expect(screen.getByText('Clear')).toBeTruthy();
    });

    it('is rendered once a complexity filter is active', () => {
      const screen = render(React.createElement(FilterBar, {
        filters: { courses: [], due: 'all', complexity: ['long'] },
        courses: COURSES,
        onChange: vi.fn(),
      }));
      expect(screen.getByText('Clear')).toBeTruthy();
    });
  });

  describe('chip taps', () => {
    it('tapping a course chip adds it to filters.courses, preserving other fields', () => {
      const onChange = vi.fn();
      const filters = { courses: [], due: 'today', complexity: ['short'] };
      const screen = render(React.createElement(FilterBar, { filters, courses: COURSES, onChange }));

      screen.firePressOnText('CS101');

      expect(onChange).toHaveBeenCalledWith({ courses: ['CS101'], due: 'today', complexity: ['short'] });
    });

    it('tapping an already-selected course chip removes it (toggle off)', () => {
      const onChange = vi.fn();
      const filters = { courses: ['CS101', 'MATH201'], due: 'all', complexity: [] };
      const screen = render(React.createElement(FilterBar, { filters, courses: COURSES, onChange }));

      screen.firePressOnText('CS101');

      expect(onChange).toHaveBeenCalledWith({ courses: ['MATH201'], due: 'all', complexity: [] });
    });

    it('tapping a due-range chip switches the single-select due value', () => {
      const onChange = vi.fn();
      const filters = { courses: ['CS101'], due: 'all', complexity: [] };
      const screen = render(React.createElement(FilterBar, { filters, courses: COURSES, onChange }));

      screen.firePressOnText('Overdue');

      expect(onChange).toHaveBeenCalledWith({ courses: ['CS101'], due: 'overdue', complexity: [] });
    });

    it('tapping "This week" sets due to "week"', () => {
      const onChange = vi.fn();
      const screen = render(React.createElement(FilterBar, { filters: emptyFilters(), courses: COURSES, onChange }));

      screen.firePressOnText('This week');

      expect(onChange).toHaveBeenCalledWith({ courses: [], due: 'week', complexity: [] });
    });

    it('tapping a complexity chip adds it to filters.complexity', () => {
      const onChange = vi.fn();
      const filters = { courses: [], due: 'all', complexity: ['short'] };
      const screen = render(React.createElement(FilterBar, { filters, courses: COURSES, onChange }));

      screen.firePressOnText('Long');

      expect(onChange).toHaveBeenCalledWith({ courses: [], due: 'all', complexity: ['short', 'long'] });
    });

    it('tapping an already-selected complexity chip removes it (toggle off)', () => {
      const onChange = vi.fn();
      const filters = { courses: [], due: 'all', complexity: ['short', 'long'] };
      const screen = render(React.createElement(FilterBar, { filters, courses: COURSES, onChange }));

      screen.firePressOnText('Short');

      expect(onChange).toHaveBeenCalledWith({ courses: [], due: 'all', complexity: ['long'] });
    });

    it('tapping Clear resets filters to emptyFilters()', () => {
      const onChange = vi.fn();
      const filters = { courses: ['CS101'], due: 'today', complexity: ['long'] };
      const screen = render(React.createElement(FilterBar, { filters, courses: COURSES, onChange }));

      screen.firePressOnText('Clear');

      expect(onChange).toHaveBeenCalledWith(emptyFilters());
    });
  });
});
