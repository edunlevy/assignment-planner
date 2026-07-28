import { Pressable, ScrollView, Text, View } from 'react-native';
import { emptyFilters, hasActiveFilters } from '../lib/filtering';
import { COMPLEXITY_OPTIONS, PRIMARY, WHITE, TEXT_SECONDARY, BORDER, DANGER } from '../lib/constants';

// Due-range chips are single-select; 'all' is the default and has no
// dedicated "no filter" affordance beyond being the initially-selected chip.
const DUE_OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
];

// One pill. `selected` drives the PRIMARY-filled / outlined look shared with
// AssignmentFormModal's complexity picker; `tone` lets the Clear chip use the
// danger color instead of PRIMARY when selected-styled.
function Chip({ label, selected, onPress, tone = PRIMARY }) {
  return (
    <Pressable
      onPress={onPress}
      className="rounded-full px-3 py-1.5 mr-2 border"
      style={{
        backgroundColor: selected ? tone : 'transparent',
        borderColor: selected ? tone : BORDER,
      }}
    >
      <Text
        className="text-xs font-semibold"
        style={{ color: selected ? WHITE : TEXT_SECONDARY }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// A thin vertical rule between chip groups so the three filter dimensions
// (due range / course / complexity) read as visually distinct clusters in a
// single scrolling row.
function Divider() {
  return <View className="w-px h-5 mr-2" style={{ backgroundColor: BORDER }} />;
}

// Horizontally scrollable filter chip bar. Fully controlled: no internal
// state, every tap derives the next full filters object and hands it to
// onChange — App.js owns the actual filters state.
export default function FilterBar({ filters, courses, onChange }) {
  function setDue(key) {
    onChange({ ...filters, due: key });
  }

  function toggleCourse(course) {
    const next = filters.courses.includes(course)
      ? filters.courses.filter(c => c !== course)
      : [...filters.courses, course];
    onChange({ ...filters, courses: next });
  }

  function toggleComplexity(key) {
    const next = filters.complexity.includes(key)
      ? filters.complexity.filter(c => c !== key)
      : [...filters.complexity, key];
    onChange({ ...filters, complexity: next });
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="px-4 mb-3"
      contentContainerStyle={{ alignItems: 'center', paddingRight: 16 }}
    >
      {DUE_OPTIONS.map(opt => (
        <Chip
          key={opt.key}
          label={opt.label}
          selected={filters.due === opt.key}
          onPress={() => setDue(opt.key)}
        />
      ))}

      {courses.length > 0 && <Divider />}
      {courses.map(course => (
        <Chip
          key={course}
          label={course}
          selected={filters.courses.includes(course)}
          onPress={() => toggleCourse(course)}
        />
      ))}

      <Divider />
      {COMPLEXITY_OPTIONS.map(({ key, label }) => (
        <Chip
          key={key}
          label={label}
          selected={filters.complexity.includes(key)}
          onPress={() => toggleComplexity(key)}
        />
      ))}

      {hasActiveFilters(filters) && (
        <Chip
          label="Clear"
          selected
          tone={DANGER}
          onPress={() => onChange(emptyFilters())}
        />
      )}
    </ScrollView>
  );
}
