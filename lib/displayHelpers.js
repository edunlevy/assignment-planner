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

// Converts "HH:MM" (24-hour) to "h:MM AM/PM". Returns '' for invalid input.
export function formatTime(hhmm) {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return '';
  const [h, m] = hhmm.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return '';
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

export function complexityLabel(key) {
  return COMPLEXITY_LABELS[key] ?? 'Medium';
}

// Returns a due-date display object: { text: string, urgent: boolean }.
//   urgent: true  → shown in red (overdue, today, tomorrow)
//   urgent: false → shown in muted grey
//
// today is optional (defaults to new Date()) so tests can pin the clock.
// dueTime is an optional "HH:MM" string; when provided it is appended to the label.
//
// When dueTime is set and the calendar date is today, we compare at full
// datetime resolution: a 9 AM assignment at 5 PM is "Overdue", not "Due today".
export function dueDateLabel(dueDateStr, today = new Date(), dueTime) {
  const formattedTime = dueTime ? formatTime(dueTime) : '';
  const timeSuffix = formattedTime ? ` at ${formattedTime}` : '';
  try {
    const days = differenceInCalendarDays(parseISO(dueDateStr), today);

    if (days === 0 && dueTime && /^\d{2}:\d{2}$/.test(dueTime)) {
      const [y, mo, d] = dueDateStr.split('-').map(Number);
      const [h, mn] = dueTime.split(':').map(Number);
      if (h <= 23 && mn <= 59) {
        const dueAt = new Date(y, mo - 1, d, h, mn, 0);
        if (dueAt < today) return { text: `Overdue${timeSuffix}`, urgent: true };
      }
    }

    if (days < 0)   return { text: `Overdue${timeSuffix}`,              urgent: true  };
    if (days === 0)  return { text: `Due today${timeSuffix}`,            urgent: true  };
    if (days === 1)  return { text: `Due tomorrow${timeSuffix}`,         urgent: true  };
    if (days <= 7)   return { text: `Due in ${days} days${timeSuffix}`,  urgent: false };
    return            { text: `Due ${dueDateStr}${timeSuffix}`,          urgent: false };
  } catch {
    return { text: `Due ${dueDateStr}${timeSuffix}`, urgent: false };
  }
}
