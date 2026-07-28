# Assignment Planner — Feature Plan (calendar-sync fix, filtering, recurrence)

Companion to PHASE_PLAN.md (stabilization/refactor). Three items, planned 2026-07-28.
Suggested PR order: F1 (bugfix) → F2 → F3a → F3b. One PR each, shipped via the
usual ship-pr loop (CI + scored review, fix >49).

---

## F1 — Fix "Could not turn on calendar sync" (bug) — ROOT CAUSE FOUND, fix on branch fix/calendar-sync-legacy-api

**Observed:** On a real iPhone (TestFlight/dev build), enabling sync shows
*"Could not turn on calendar sync. Please try again."* — the generic catch in
`ProfileModal.handleEnableCalendarSync`.

**Actual root cause (found 2026-07-28, different from the original suspects):**
expo-calendar 57 (part of the Expo SDK 54→57 upgrade, PR #38) moved the
classic function API to the **`expo-calendar/legacy`** entry point. Every
name lib/calendarSync.js imported from plain `'expo-calendar'`
(`requestCalendarPermissionsAsync`, `getCalendarsAsync`,
`createCalendarAsync`, `createEventAsync`, …) is now a deprecation stub that
**throws at runtime**. So `enableSync` threw at the very first native call →
generic catch. Tests kept passing because jest.setup.js mocked
`'expo-calendar'` wholesale — including `getDefaultCalendarSourceAsync`,
which **doesn't exist in expo-calendar 57 at all** (not even in legacy; its
replacement is `getDefaultCalendarAsync().source`). Classic mock-drift.

**Shipped fix:**

1. calendarSync.js imports from `expo-calendar/legacy`; iOS source selection
   uses `getDefaultCalendarAsync().source` with a `getSourcesAsync()`
   fallback (CalDAV → local → any; throws if none). Swallowed errors now
   `console.warn` so field failures are diagnosable.
2. `requestCalendarAccess()` returns `'granted' | 'writeOnly' | 'denied'` —
   write-only ("Add Events Only", iOS 17+) is detected via the new API's
   `getCalendarPermissions(true)` probe (legacy/full check reports write-only
   as denied; the probe reports it granted — the combination is unambiguous).
   Full access is genuinely required: listing calendars + creating our own
   calendar aren't allowed under write-only.
3. `enableSync` returns `{ ok } | { ok: false, reason: 'denied'|'writeOnly'|'createFailed' }`
   and no longer flips the enabled flag when calendar creation fails.
4. ProfileModal shows a distinct, actionable message per reason, with an
   **Open Settings** button (`Linking.openSettings()`) on the two
   permission-shaped failures.
5. Tests updated to the real legacy surface + new branches (source fallback,
   write-only detection, per-reason UI).

**Remaining risk:** the write-only probe's exact native behavior is verified
against expo-calendar 57's Swift requesters (writeOnly probe: granted for
writeOnly|fullAccess; legacy check: granted only for fullAccess) but not yet
on a device — validate on the next TestFlight build.

---

## F2 — Filter assignments by class, due date, complexity

Today App.js renders one list: `sortForList(assignments)` with no filtering.
All needed fields already exist per assignment: `course`, `dueDate`,
`dueTime`, `complexity`, `importance`, `status`.

**Plan:**

1. **Pure helpers first** — `lib/filtering.js`:
   `applyFilters(assignments, filters)` with
   `filters = { courses: [], due: 'all'|'overdue'|'today'|'week', complexity: [], status: 'all'|'active'|'completed' }`,
   plus `distinctCourses(assignments)`. Fully unit-testable, no UI coupling.
2. **State + wiring** — filter state in App.js (or a small `useFilters` hook),
   applied inside the existing `useMemo` **before** `sortForList`.
   `workOnNext` and `incompleteCount` stay computed from the *unfiltered*
   list (filtering the view shouldn't change what "work on next" recommends
   or the header count).
3. **UI** — a horizontal chip bar between header and list: Class chips (from
   `distinctCourses`), Due segmented chips (All / Overdue / Today / This
   week), Complexity chips, and a Clear-all chip visible whenever any filter
   is active. Empty-filtered-result state reuses EmptyState with a "no
   matches — clear filters" variant.
4. **Persistence** — session-only to start (reset on app restart). Per-user
   AsyncStorage persistence is a cheap follow-up if it feels annoying.
5. **Tests:** unit tests for lib/filtering.js; component test for the chip
   bar; one integration test (filter → list shrinks → clear → restored).

---

## F3 — Recurrence: richer rules + "this vs. all future" edits

Current model: `lib/recurring.js` materializes a series at creation time into
individual assignment rows sharing a `seriesId` (weekly/biweekly only, until
an end date, capped at 52). No recurrence metadata survives creation; the
only series-wide operation is delete (`removeSeries`). Recurrence can only be
set when creating, not when editing.

### F3a — Richer recurrence rules (all four selected)

1. **Rule model** — replace `buildWeeklySeries` with a rule-driven generator:
   `buildSeries({ startISO, base, seriesId, rule })` where
   `rule = { freq: 'weekly'|'monthly', interval: N, byWeekday: ['MO','WE',...], end: { untilISO } | { count: N } }`.
   Covers: specific weekdays, monthly, every N weeks, end-after-N-occurrences.
   Keep the 52-occurrence hard cap and the count-before-build validation in
   formValidation.js. Monthly day-31 → months without that day skip (document
   the choice; simplest and matches most planners).
2. **Store the rule** on the series (new `recurrence_rule` JSONB column via a
   db/migrations migration, or serialized field on each row — decide in PR;
   column on rows keyed by seriesId is simplest with current schema). This is
   what makes F3b's "regenerate future" and future rule-editing possible, and
   costs little now.
3. **Form UI** — RecurringSeriesSection grows: frequency selector
   (weekly/monthly), interval stepper (every N weeks), weekday multi-picker
   (weekly only), end mode toggle (on date / after N times). Validation
   messages in formValidation.js updated to match.
4. **Tests:** table-driven unit tests for the generator (weekday combos,
   monthly edge days, count vs until, cap), formValidation branches, form
   component tests.

### F3b — Edit scope: "just this one" vs. "this and all future"

1. **Save-time choice** — when saving edits to an assignment that has a
   `seriesId`, present a 3-way choice (Alert.alert + web confirm fallback,
   same pattern as series delete): Cancel / Just this occurrence / This and
   future occurrences.
2. **Semantics** —
   - *Just this one:* current behavior (row updated in place).
   - *This and future:* apply to every row in the series with
     `dueDate >= this row's original dueDate`. Non-date fields (title,
     course, importance, complexity, dueTime) copy directly. A **due-date
     change applies as a day-delta** to each future occurrence (moved Tue→Thu
     shifts the whole tail by +2 days), preserving spacing. No
     re-materialization from the rule in v1 — shifting existing rows is
     predictable and keeps completed/past rows untouched.
3. **Plumbing** — new `updateSeriesFrom(seriesId, fromDate, changes)` in
   useAssignments + a batched update in lib/assignmentsDb.js (mirror
   `dbDeleteSeries`), optimistic local commit, mutation-guard coverage, and
   realtime-echo handling. Reminders and calendar events reschedule for every
   affected row — `scheduleBatchFor` already exists on the calendar side;
   reminders need the equivalent loop.
4. **Optional (cheap while in there):** "Delete this and future occurrences"
   alongside the existing whole-series delete.
5. **Tests:** unit (delta math, boundary = edited row included, past rows
   excluded), integration over fakeSupabase (edit future → rows updated,
   reminders/calendar rescheduled, realtime echo idempotent).

---

## Risks / notes

- F1 step 2 depends on what expo-calendar (~57.0.1) actually reports for
  write-only grants — verify `accessPrivileges` in the repro step before
  building the UI branch on it.
- F3b touches the mutation/realtime/orchestration stack — the most
  regression-prone area; lean on the existing integration-test tier
  (__tests__/helpers/fakeSupabase.js) and keep it a separate PR from F3a.
- F2 is independent of everything and can ship any time.
