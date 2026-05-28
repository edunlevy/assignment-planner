import { differenceInCalendarDays, parseISO } from 'date-fns';

// Complexity key → display label. Mirrors the labels in COMPLEXITY_OPTIONS
// (AssignmentFormModal.js) without importing from a component file.
// Falls back to 'Medium' for any pre-migration row whose complexity is
// undefined/null (sanitizeAssignment already defaults these to 'medium',
// so this is belt-and-suspenders).
const COMPLEXITY_LABELS = {
  short: 'Short',
  medium: 'Medium',
  long: 'Long',
};

export function complexityLabel(key) {
  return COMPLEXITY_LABELS[key] ?? 'Medium';
}

// Returns a due-date display object: { text: string, urgent: boolean }.
//   urgent: true  → shown in red (overdue, today, tomorrow)
//   urgent: false → shown in muted grey
//
// today is optional (defaults to new Date()) so tests can pin the clock.
export function dueDateLabel(dueDateStr, today = new Date()) {
  try {
    const days = differenceInCalendarDays(parseISO(dueDateStr), today);
    if (days < 0)  return { text: 'Overdue',              urgent: true  };
    if (days === 0) return { text: 'Due today',            urgent: true  };
    if (days === 1) return { text: 'Due tomorrow',         urgent: true  };
    if (days <= 7)  return { text: `Due in ${days} days`,  urgent: false };
    return           { text: `Due ${dueDateStr}`,          urgent: false };
  } catch {
    return { text: `Due ${dueDateStr}`, urgent: false };
  }
}
