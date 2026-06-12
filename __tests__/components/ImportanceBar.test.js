import React from 'react';
import { render } from '../helpers/renderWithProviders';
import ImportanceBar from '../../components/ImportanceBar';

// Mirror the component's internal constants so tests break if colors drift.
const SEGMENT_COLORS = ['#BFC8FF', '#91A7FF', '#5C7CFA', '#3B5BDB', '#1E3A8A'];
const INACTIVE_COLOR = '#E8ECFF';

function getSegments(value) {
  const screen = render(React.createElement(ImportanceBar, { value }));
  return screen.toJSON().children; // array of 5 segment View nodes
}

describe('ImportanceBar', () => {
  it('renders exactly 5 segments', () => {
    expect(getSegments(3)).toHaveLength(5);
  });

  it('value=1: only the first segment is active', () => {
    const segs = getSegments(1);
    expect(segs[0].props.style.backgroundColor).toBe(SEGMENT_COLORS[0]);
    expect(segs[1].props.style.backgroundColor).toBe(INACTIVE_COLOR);
    expect(segs[2].props.style.backgroundColor).toBe(INACTIVE_COLOR);
    expect(segs[3].props.style.backgroundColor).toBe(INACTIVE_COLOR);
    expect(segs[4].props.style.backgroundColor).toBe(INACTIVE_COLOR);
  });

  it('value=3: first three segments are active, last two are inactive', () => {
    const segs = getSegments(3);
    expect(segs[0].props.style.backgroundColor).toBe(SEGMENT_COLORS[0]);
    expect(segs[1].props.style.backgroundColor).toBe(SEGMENT_COLORS[1]);
    expect(segs[2].props.style.backgroundColor).toBe(SEGMENT_COLORS[2]);
    expect(segs[3].props.style.backgroundColor).toBe(INACTIVE_COLOR);
    expect(segs[4].props.style.backgroundColor).toBe(INACTIVE_COLOR);
  });

  it('value=5: all segments are active with correct colors', () => {
    const segs = getSegments(5);
    SEGMENT_COLORS.forEach((color, i) => {
      expect(segs[i].props.style.backgroundColor).toBe(color);
    });
  });

  it('value=5: each segment has a distinct color (ramp increases)', () => {
    const segs = getSegments(5);
    const colors = segs.map(s => s.props.style.backgroundColor);
    const unique = new Set(colors);
    expect(unique.size).toBe(5);
  });

  it('inactive segments all share the same inactive color', () => {
    const segs = getSegments(2);
    [2, 3, 4].forEach(i => {
      expect(segs[i].props.style.backgroundColor).toBe(INACTIVE_COLOR);
    });
  });
});
