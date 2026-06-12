// ---------------------------------------------------------------------------
// Shared semantic tokens: status, importance, and complexity
//
// Single source of truth for the status labels/colors, the importance-level
// color ramp, and the complexity labels used across components. Keeping
// these here avoids components importing UI constants from one another and
// keeps the values from drifting out of sync.
// ---------------------------------------------------------------------------

const STATUS_LABELS = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  completed: 'Completed',
};

const STATUS_COLORS = {
  not_started: '#FF6B6B',
  in_progress: '#FFB347',
  completed: '#6BCB77',
};

// Complexity / length gauge. Order matches the picker (Short → Medium → Long).
// Numeric weights live in lib/ordering.js — this file only owns labels + UI.
const COMPLEXITY_OPTIONS = [
  { key: 'short',  label: 'Short',  hint: '< 1 hour' },
  { key: 'medium', label: 'Medium', hint: '1–2 hours' },
  { key: 'long',   label: 'Long',   hint: '3+ hours' },
];

// Complexity key → display label, derived from COMPLEXITY_OPTIONS so the two
// never drift.
const COMPLEXITY_LABELS = Object.fromEntries(
  COMPLEXITY_OPTIONS.map(({ key, label }) => [key, label])
);

// Importance color ramp: light lavender → deep navy, one color per
// importance level (indexed by level - 1), plus the inactive segment color.
const IMPORTANCE_COLORS = ['#BFC8FF', '#91A7FF', '#5C7CFA', '#3B5BDB', '#1E3A8A'];
const IMPORTANCE_INACTIVE_COLOR = '#E8ECFF';

// ---------------------------------------------------------------------------
// Neutral / structural theme tokens
//
// Role-named colors for the non-semantic UI chrome (text ramp, surfaces,
// borders, feedback states). Named by ROLE, not by hue, so a future palette
// change only touches this file. PRIMARY happens to share its hex with
// IMPORTANCE_COLORS[3] by design (the ramp was built around the brand blue),
// but they're kept separate because their meanings are independent.
// ---------------------------------------------------------------------------

// Brand / primary action color: buttons, links, selected states, accents.
const PRIMARY = '#3B5BDB';

// White: card/modal surfaces and text/icons rendered on PRIMARY or dark fills.
const WHITE = '#FFFFFF';

// Elevation shadow base color.
const SHADOW = '#000';

// Text ramp, high → low emphasis.
const TEXT_PRIMARY = '#1A1A2E';     // headings / high-emphasis body
const TEXT_SECONDARY = '#555';      // secondary body
const TEXT_MUTED = '#888';          // hints / muted captions
const TEXT_PLACEHOLDER = '#9AA0B4'; // input placeholder text

// Light-lavender surface system used by inputs, sections, and cards.
const SURFACE_TINT = '#F8F9FF';      // input / section fills
const SURFACE_HIGHLIGHT = '#E8ECFF'; // selected / active fill (e.g. calendar day)
const BADGE_BG = '#EEF2FF';          // status badge fill
const BORDER = '#DDE2FF';            // input / divider borders

// Feedback states.
const DANGER = '#FF6B6B';     // form validation errors (border + text)
const DANGER_BG = '#FFF5F5';  // error field background
const URGENT = '#EF4444';     // urgent due-date emphasis

// "Work on next" highlight card — a self-contained navy palette.
const WORK_CARD_BG = '#1E3A8A';
const WORK_CARD_LABEL = '#93C5FD';
const WORK_CARD_TEXT = '#BFDBFE';

export {
  STATUS_LABELS,
  STATUS_COLORS,
  COMPLEXITY_OPTIONS,
  COMPLEXITY_LABELS,
  IMPORTANCE_COLORS,
  IMPORTANCE_INACTIVE_COLOR,
  PRIMARY,
  WHITE,
  SHADOW,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_MUTED,
  TEXT_PLACEHOLDER,
  SURFACE_TINT,
  SURFACE_HIGHLIGHT,
  BADGE_BG,
  BORDER,
  DANGER,
  DANGER_BG,
  URGENT,
  WORK_CARD_BG,
  WORK_CARD_LABEL,
  WORK_CARD_TEXT,
};
