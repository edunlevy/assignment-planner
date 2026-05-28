# Project Notes

## Auth redirect URLs (Supabase dashboard — one-time setup)

The password-reset and email-confirmation flows use hosted redirect pages on
GitHub Pages to bridge the gap between Supabase's `https://` email links and
the app's `assignmentplanner://` deep-link scheme.

**Add both of these to Supabase → Authentication → URL Configuration → Redirect URLs:**

```
https://edunlevy.github.io/assignment-planner/reset-password.html
https://edunlevy.github.io/assignment-planner/confirm-email.html
```

A wildcard entry also works and is easier to maintain:

```
https://edunlevy.github.io/**
```

Without this, Supabase ignores the `redirectTo` parameter and the email link
either points to a broken URL or is stripped entirely.

**Site URL** (Supabase → Authentication → URL Configuration → Site URL):

```
https://edunlevy.github.io/assignment-planner
```

---

## Phase 8 — Supabase Setup

### What to do manually (one-time, in the Supabase dashboard)

1. Go to https://supabase.com → create a new project
   - Save the database password somewhere safe (password manager)
   - Wait ~2 min for provisioning

2. Open the **SQL Editor** and run the SQL below (creates the table + RLS)

3. Go to **Project Settings → API**
   - Copy the **Project URL** → paste into `.env` as `EXPO_PUBLIC_SUPABASE_URL`
   - Copy the **anon / public key** → paste into `.env` as `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - The anon key is safe to ship in the app; the service_role key is not — never commit it

4. Verify: in **Table Editor → assignments**, manually insert a row and confirm it appears

---

### SQL — paste this into the Supabase SQL Editor

```sql
-- Create the assignments table
create table public.assignments (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  class_name  text        not null,
  title       text        not null,
  due_date    date        not null,
  importance  int         not null default 3,
  status      text        not null default 'not_started',
  series_id   text,                          -- nullable; links recurring occurrences
  created_at  timestamptz not null default now(),

  constraint importance_range check (importance between 1 and 5),
  constraint valid_status     check (status in ('not_started', 'in_progress', 'completed'))
);

-- Enable Row Level Security
alter table public.assignments enable row level security;

-- Policy: users can only read/write their own rows
create policy "Users manage own assignments"
  on public.assignments
  for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

---

### Schema notes for Phase 9

| App field  | DB column    | Notes                                      |
|------------|--------------|--------------------------------------------|
| `course`   | `class_name` | Rename on insert/select in Phase 9         |
| `dueDate`  | `due_date`   | App stores YYYY-MM-DD string; DB uses date |
| `seriesId` | `series_id`  | text (app generates timestamp strings)     |
| `id`       | `id`         | App uses string IDs; DB generates UUIDs — Phase 9 will use DB-generated IDs |

The `user_id` column is populated from `supabase.auth.getUser().data.user.id`
in Phase 9 — the app never stores it locally.

---

## Phase 11 — Reminder IDs (optional DB migration)

Notification IDs (`reminderIds`) are stored locally in AsyncStorage only.
To persist them to Supabase so they survive a fresh login, run this in the SQL Editor:

```sql
alter table public.assignments
  add column if not exists reminder_ids text[] default '{}';
```

Without this, reminders still fire on the device but cannot be
programmatically canceled after a fresh login or on a second device.

---

## Phase D — Realtime sync (required)

The app now subscribes to `postgres_changes` on the `assignments` table so a
write on one device shows up on another within ~1 second, with reminders
rescheduled or cancelled on each device. For this to work the table must be
in the `supabase_realtime` publication. Run once in the SQL editor:

```sql
alter publication supabase_realtime add table public.assignments;
```

Notes:
- The subscription is filtered by `user_id=eq.<current user>`, so a user
  never sees another user's changes. RLS still applies to the underlying
  rows.
- Self-echoes (events that originated from this device) are suppressed by
  an in-memory id set with an 8-second TTL. If a device's clock is wildly
  off or its channel reconnects after a long pause, an echo could
  occasionally slip through and be reapplied — that's idempotent except
  for the reminder reschedule, which would cancel + re-create the same
  reminder. Acceptable.
- DELETE events only carry the row id (default `REPLICA IDENTITY`), which
  is all we need. If you ever want the full old row on DELETE, run:
  `alter table public.assignments replica identity full;`

---

## Phase E — Complexity / length gauge

> **⚠️ Required before deploying** — `lib/assignmentsDb.js` reads and writes
> a `complexity` column that does not exist in the original schema. Run the
> SQL below in the Supabase SQL Editor before shipping the PR 3 build.
> Fresh installs and production databases without this migration will error
> on every INSERT and UPDATE once the client starts sending `complexity`.

Adds a per-assignment `complexity` field so the recommendation logic (PR 4)
can surface longer assignments earlier than short ones with similar due
dates. Values: `'short'`, `'medium'`, `'long'`. Default: `'medium'` (so
existing rows stay valid without a backfill).

The canonical SQL is in **[`db/migrations/2026-05-27_complexity_column.sql`](db/migrations/2026-05-27_complexity_column.sql)**
— use that file to apply the migration. The DDL below is kept here for
reference only.

```sql
alter table public.assignments
  add column if not exists complexity text not null default 'medium';

-- Constrain to the three valid values. The check is added separately so the
-- column ADD is non-blocking on a large table.
alter table public.assignments
  drop constraint if exists assignments_complexity_check;

alter table public.assignments
  add constraint assignments_complexity_check
  check (complexity in ('short', 'medium', 'long'));
```

Notes:
- `sanitizeAssignment` defaults `complexity` to `'medium'` for cached rows
  that pre-date the migration, so the app keeps working if AsyncStorage has
  rows without the field.
- Realtime payloads pick up the new column automatically via `fromDb`'s
  `FIELD_MAP`-driven mapper — no realtime publication change required.

---

## Audit — Time zone behavior (pre-fix)

This section documents the current notification time-zone behavior before the
time-zone-aware fix lands. No code has been changed yet; this is the baseline
reviewers should confirm against the source.

### Where local time is touched

| File / line | Code | Effect |
|---|---|---|
| [lib/notifications.js:64-66](lib/notifications.js) | `new Date(y, m-1, d, 23, 59, 0)` | Builds a JS Date at 23:59 in the **device's current local TZ at scheduling time** |
| [lib/notifications.js:94](lib/notifications.js) | `trigger: { type: 'date', date: new Date(triggerMs), channelId: 'reminders' }` | Schedules at an **absolute UTC moment** (derived from `triggerMs = dueAt.getTime() - offsetMs`) |
| [App.js:30](App.js) | `differenceInCalendarDays(parseISO(dueDateStr), new Date())` | Renders "Due in N days" using device local clock — recomputes on every render, so it is naturally TZ-correct |
| [lib/recurring.js](lib/recurring.js) | `parseISO`, `addWeeks`, `format(..., 'yyyy-MM-dd')` | Operates on date strings only — no time component, so TZ-immune |
| [components/DueDateField.js](components/DueDateField.js) | `format(selectedDate, 'yyyy-MM-dd')` | Stores date-only string — TZ-immune |

The `dueDate` field is stored as a date-only `'YYYY-MM-DD'` string (DB column
type `date`). The TZ problem is **not** in storage — it is in how the trigger
millisecond is materialised at scheduling time.

### Root cause

`expo-notifications` with `type: 'date'` translates to:
- **iOS**: `UNTimeIntervalNotificationTrigger` — fires when the system clock
  reaches that UTC instant. Wall-clock local time is irrelevant.
- **Android**: `AlarmManager.setExact` (or `setExactAndAllowWhileIdle`) at
  the absolute timestamp — same behavior, fires at the UTC instant.

So once scheduled, the notification's fire moment is frozen in UTC. The
device's later interpretation of that moment in local wall time depends on
its current TZ.

### Concrete failure scenario

1. User in **EST** (UTC-5) creates an assignment with `dueDate = '2026-06-01'`.
2. `scheduleReminders` runs: `dueAt = new Date(2026, 5, 1, 23, 59, 0)` =
   2026-06-01 23:59 EST = **2026-06-02 04:59 UTC**.
3. The 24-hour reminder is scheduled for `triggerMs = dueAt.getTime() - 86400000`
   = **2026-06-01 04:59 UTC** = 2026-05-31 23:59 EST. ✓ Correct.
4. User flies to **PST** (UTC-8). Phone TZ updates.
5. The reminder still fires at 2026-06-01 04:59 UTC, which the phone now
   displays as **2026-05-31 20:59 PST**. ✗ User receives "Due tomorrow" three
   hours before midnight on the day *before* due, not at 11:59 PM local.

The 1-hour reminder has the same flaw, just smaller absolute offset.

### Why the load effect doesn't save us

The load effect in `useAssignments.js` reschedules reminders only for rows
with `reminderIds.length === 0`. After a TZ change, rows still have their
stale IDs in the map, so the reschedule branch is skipped.

A naive fix that just rescheduled on every load would also not help — the
load effect runs on app launch / userId change, not on a TZ change while the
app is already open.

### Proposed fix (lands in next PR)

Two complementary layers — see the `timezone-notifications` skill for the
full implementation pattern:

1. **CALENDAR trigger**: switch from
   `{ type: 'date', date: ... }` to
   `{ type: SchedulableTriggerInputTypes.CALENDAR, year, month, day, hour, minute }`.
   iOS `UNCalendarNotificationTrigger` fires at the local date/time
   components in whatever TZ the device is in at fire time — automatic
   adjustment on TZ change.

2. **AppState reschedule**: persist the device TZ string per user; when the
   app foregrounds and the current TZ differs from the stored TZ, cancel and
   reschedule all incomplete-assignment reminders. Covers the Android edge
   case and acts as belt-and-suspenders on iOS.

### Sentinel tests

Three `test.todo` entries were added to `__tests__/lib/notifications.test.js`
under the `describe('time zone behavior', ...)` block as part of the audit PR.
They were promoted to **passing tests** in the subsequent fix PR (PR 2) once
the CALENDAR trigger and AppState reschedule were implemented.

---

## Recommended index for scale

`dbFetch` filters by `user_id` and orders by `due_date`. Once any single user has
more than a few hundred rows (or the table accumulates many users), add a
composite index so the order-by doesn't require a sort:

```sql
create index if not exists assignments_user_due_idx
  on public.assignments (user_id, due_date);
```

Run this in the Supabase SQL editor. RLS still applies; the index just makes the
already-filtered scan an index scan instead of a heap + sort.
