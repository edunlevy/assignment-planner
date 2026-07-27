# Assignment Planner — Stabilization & Refactoring Plan

> **Status (updated 2026-07-27):** This plan is largely executed. Phase 1
> (stabilization) is complete and Phase 2's refactors are merged
> (`lib/mutationGuards.js`, `lib/userKeyedLock.js`, `useAuthSession`/
> `useDeepLinkAuth`, test-infra + polish). Current stack: **Expo 57 · React
> Native 0.86 · React 19.2.3** (the SDK upgrade is in a draft PR pending a
> device build — see the security note in §2). Suite is now **680 tests / 41
> files**; whole-app coverage ~93.5% lines / ~87.4% branches. The remaining
> work is the two follow-ups tracked in memory (apply the DB migration to prod;
> finish/merge the Expo 57 upgrade). The sections below are preserved as the
> original plan of record.
>
> _Original plan-time baseline:_ Generated 2026-07-24 @ `main` `f4c62f9`, 599
> tests / 33 files, on Expo 54 · React Native 0.81 · React 19 · Supabase (auth +
> Postgres + Realtime) · expo-notifications · expo-calendar · AsyncStorage ·
> NativeWind/Tailwind · Vitest 4 (node env).

---

## 1. High-level summary

This is **not** a greenfield testing effort. The project already carries ~8,300 lines of tests
covering nearly every module, with coverage gates at **lines 90 / statements 88 / functions 86 /
branches 80** (actuals ≈ 93 / 90 / 89 / 84). The honest framing of the two phases is:

- **Phase 1 (Stabilization)** is about *closing specific, known gaps* and *making the safety net
  trustworthy* — not "adding tests for everything." Three real gaps exist:
  1. **UI code is not line-counted.** `coverage.include` is restricted to `lib/**` + `hooks/**`.
     `components/`, `screens/`, and `App.js` have tests that *run* but are invisible to coverage
     (the v8 provider can't parse the metro/JSX transform for zero-coverage maps). We don't actually
     know their real coverage.
  2. **`hooks/useAssignments.js` branch coverage ≈ 73%** — the concurrency core (self-mutation
     markers, tombstones, per-id queue, stale-fetch guard, realtime reconcile) is the single highest
     risk in the codebase and its least-covered branches are exactly the race paths.
  3. **No integration/flow tests.** Everything is unit-level. The multi-module flows (create →
     schedule reminder → mirror to calendar → realtime echo suppression) are only tested per-unit,
     so cross-module contract drift can pass CI.

- **Phase 2 (Refactoring)** targets the structural debt that makes the above expensive to maintain:
  a 667-line hook doing too much, duplicated map-lock/orchestration logic across two hooks, a slow
  test suite (~3 min; the `--coverage` build exceeds 5 min locally), and a handful of latent bugs
  the code comments already flag. **Every refactor is gated behind the Phase-1 tests that lock in
  current behavior first.**

**Guiding principle (per your standing workflow):** self-score every change 0–100, fix anything
> 49, and never downshift correctness-critical concurrency/auth work. Green CI is not proof a race
is fixed.

---

## 2. Prioritized checklist

Priority = `risk × reach`. P0 = do first.

### Phase 1 — Stabilization
- [x] **P0** ~~Restore UI line-coverage measurement~~ **DONE (2026-07-24, branch `phase1-ui-coverage`)** —
      `components/`, `screens/`, `App.js` are now line-counted; `test:ci` green with honest whole-app
      numbers. See §6 for the approach and the real per-file numbers it exposed.
- [ ] **P0** Close `useAssignments.js` branch gap 73% → ≥ 85%: race/echo/tombstone/stale-fetch paths.
- [ ] **P0** Add integration tests for the 4 critical flows (§ below): create, edit, delete, realtime.
- [ ] **P1** Cover the explicit deferred edge cases in `notifications.js` (iOS 64-slot budget overrun,
      Android DATE-trigger path, legacy vs `{ids,sig}` reminder-map migration).
- [ ] **P1** `App.js` deep-link auth matrix (PKCE `?code=`, implicit recovery, implicit signup-confirm,
      account-switch-with-no-null).
- [ ] **P1** `ProfileModal` / account deletion cleanup (calendar + reminder + ranking-cache teardown) —
      these are the last 8 commits' worth of bug fixes; lock them in.
- [ ] **P2** Raise coverage gates to just-below new actuals once UI is counted; wire a coverage
      artifact/summary into CI comment.
- [ ] **P2** Silence `react-test-renderer` deprecation + "act() not configured" warnings (migrate the
      few renderer-based tests to `@testing-library/react-native` render).

### Phase 2 — Refactoring (each gated on Phase-1 tests)
- [ ] **P0** Fix latent bugs flagged in comments (§7) — behavior-preserving, test-first.
- [ ] **P0** Extract the concurrency primitives out of `useAssignments.js` into a testable,
      framework-free module (`lib/mutationGuards.js`): self-mutation markers, tombstones, per-id queue.
- [ ] **P1** De-duplicate the per-user map-lock + orchestration shape shared by
      `useReminderOrchestration` and `useCalendarOrchestration` into one helper.
- [ ] **P1** CI-harden the test job: add `timeout-minutes: ~15` to `test.yml` and cache `.vitest-cache`.
      *(Cold `test:ci` is ~7 min and can intermittently hang at 0% CPU on the Node 22+ worker handshake;
      the job currently has no timeout, so a hang burns GitHub's 6 h default. Caching turns most runs
      warm (~6 s); the timeout caps a hang. See §6.)*
- [ ] **P2** Deeper test-suite performance (scope the transform / project split) — only if the caching
      above proves insufficient. Warm-cache is already ~6 s, so this is low priority.
- [ ] **P2** Split `useAssignments.js` (667 → orchestration + mutation API + load/lifecycle).
- [ ] **P2** Centralize the sync-error copy strings and mutation-wrapper duplication in `App.js`.
- [ ] **P2** Extract a single `flushMap`/write-through helper for the AsyncStorage cache pattern.

---

## 3. File-by-file recommendations

Legend: **R** = risk (1–5), **C?** = line-counted by coverage today.

| File | LOC | R | C? | Phase-1 action | Phase-2 action |
|---|---|---|---|---|---|
| `hooks/useAssignments.js` | 667 | 5 | ✅ (~73% br) | Fill race/echo/tombstone/stale-fetch branches to ≥85% | Extract `lib/mutationGuards.js`; split load/mutation/lifecycle |
| `lib/notifications.js` | 412 | 5 | ✅ | iOS budget overrun, Android DATE path, map migration, TZ change | None (pure lib, keep) |
| `hooks/useReminderOrchestration.js` | 364 | 4 | ✅ | Lock-serialization + cancel-on-teardown paths | Merge shared map-lock helper with calendar |
| `hooks/useCalendarOrchestration.js` | 313 | 4 | ✅ | enable/disable + reconcile-on-load branches | Merge shared map-lock helper with reminder |
| `screens/AuthScreen.js` | 511 | 4 | ❌ | Cover sign-in/up/social/reset paths once counted | Split form/validation from view |
| `App.js` | 498 | 4 | ❌ | Deep-link auth matrix + session bootstrap + mutation error banners | Extract `useAuthSession` + `useDeepLinkAuth` hooks |
| `screens/ProfileModal.js` | 425 | 4 | ❌ | Account-deletion teardown; calendar-sync toggle | Extract deletion orchestration to a hook |
| `lib/ordering.js` | 200 | 3 | ✅ | Already strong; add custom-ranking tiebreak edge cases | None |
| `components/AssignmentFormModal.js` | 217 | 3 | ❌ | Recurring vs single, edit vs create, validation errors | Thin the component; push logic to `useAssignmentForm` |
| `components/CalendarView.js` | 208 | 2 | ❌ | Marked-dates + selection behavior | None |
| `lib/assignmentsDb.js` | 114 | 3 | ✅ | field-map round-trip, nullable handling (already tested) | None |
| `lib/calendarSync.js` | 179 | 3 | ✅ | permission-denied + event-map paths | Fold shared logic w/ notifications map format |
| `lib/assignment.js` | 59 | 3 | ✅ | sanitize/rowsMatch edge cases (well covered) | None |
| `hooks/useAssignmentForm.js` | 151 | 2 | ✅ | Already covered | Absorb modal validation logic |
| `screens/ResetPasswordModal.js` | 190 | 2 | ❌ | password-match + submit states | None |
| `lib/socialAuth.js` `lib/deepLink.js` `lib/recurring.js` `lib/uuid.js` `lib/preferencesDb.js` `lib/displayHelpers.js` `lib/formValidation.js` `lib/constants.js` | — | 1–2 | ✅ | Already covered; maintain | None |

---

## 4. Critical user flows (what integration tests must assert)

1. **Create assignment** → row appears → reminder scheduled (24 h + 1 h, iOS budget respected) →
   calendar event mirrored *iff* sync on → realtime INSERT echo of our own write is **suppressed**
   (client-minted UUID marker).
2. **Edit assignment** → DB update → old reminders cancelled + new scheduled *after* confirming the
   new schedule (never lose working reminders on transient failure) → UPDATE echo matched by
   signature and suppressed → a *real* concurrent UPDATE from another device is **not** dropped.
3. **Delete assignment / series** → DB delete → reminders + calendar events cancelled → **tombstone**
   set → a late UPDATE that committed before our delete does **not** resurrect the row.
4. **Realtime + lifecycle** → sign-out / account-switch clears user-scoped state unconditionally →
   a new user whose fetch fails sees empty/error state, never the previous user's rows → TZ change on
   foreground reschedules all incomplete reminders against one shared budget.

Also assert the **data model invariants** via `sanitizeAssignment`/`rowsMatch`: importance clamps to
1–5 (default 3), status ∈ VALID_STATUSES, complexity defaults `medium`, invalid `dueTime` → undefined,
legacy cached rows (no complexity) equal freshly-fetched rows.

---

## 5. Suggested test structure

Keep the existing mirror layout (`__tests__/<area>/<Module>.test.js`) — it's clean and consistent.
Add one new tier and two shared fixtures:

```
__tests__/
  lib/            # pure logic (unchanged, strong)
  hooks/          # hook behavior via renderHook (unchanged) + fill useAssignments branches
  components/     # RTL render (unchanged)
  screens/        # RTL render (unchanged)
  app/            # App.test.js (unchanged)
  flows/          # NEW — cross-module integration tests (§4)
    create.flow.test.js
    edit.flow.test.js
    delete.flow.test.js
    realtime.flow.test.js
  helpers/
    mockAssignment.js         # (exists)
    renderWithProviders.js    # (exists)
    renderHook.js             # (exists)
    fakeSupabase.js           # NEW — one in-memory Supabase double (from/eq/order/insert/update/realtime channel)
    fakeNotifications.js      # NEW — deterministic expo-notifications double w/ pending-slot accounting
```

**Tooling — keep the current stack, it's the right choice:**
- **Vitest 4** (node env, single fork, `isolate: true`) — keep as-is. `isolate:true` is *mandatory*:
  `isolate:false` caused a ~1-in-3 coverage-only flake from cross-file mock / `IS_REACT_ACT_ENVIRONMENT`
  bleed. Do not touch this in either phase.
- **@testing-library/react-native** for UI — standardize on it and retire the remaining
  `react-test-renderer` usages (source of the deprecation + `act()` warnings).
- **v8 coverage** — keep, but fix the `include` so UI is counted (§6, Phase-1 P0).
- Use the `fake*` doubles above instead of ad-hoc per-test mocks so the integration tier stays fast
  and the mock surface has one owner.

---

## 6. The coverage-measurement fix (Phase-1 P0) — ✅ DONE

**Root cause (confirmed):** the old `rnJsxPlugin` served JSX-stripped UI code from a *virtual* `\0jsx:`
module id **with no source map**. The v8 coverage provider attributes execution by *real* file path +
source map, so it read the real `components/*.js` / `screens/*.js` / `App.js` from disk, saw raw
(unparseable) JSX, and could not count them — they ran but were invisible, and a broad `include` made
the uncovered-file scan hang at ~0% CPU.

**Fix shipped (no new dependencies, v8 retained):**
- Rewrote `rnJsxPlugin` as a real-id `transform` hook (`enforce: 'pre'`) that strips JSX **in place**
  and **emits a source map** (`sourceMaps: true`). v8 now maps executed UI code straight back to the
  original `.js`.
- The historical hang does not recur because the v8 uncovered-file scan runs each included file back
  through the Vite transform pipeline (so `rnJsxPlugin` strips its JSX) *before* parsing — even a UI
  file no test imports parses fine.
- Widened `coverage.include` to `lib/ + hooks/ + components/ + screens/ + App.js`; excluded
  `**/*.styles.js` and non-app trees.
- Thresholds: a whole-app floor **(lines 89 / statements 87 / functions 81 / branches 80)** plus
  per-glob floors protecting the mature core — `lib/**` (lines 92 / branches 88) and
  `hooks/**` (lines 95 / branches 79). `test:ci` passes all of them.

**Honest numbers this exposed (the real Phase-1 backlog):**
`All files: lines 90.35 / statements 88.30 / functions 82.63 / branches 82.09.` The low points are now
visible and prioritized below: **App.js 51% lines / 44% branch** (deep-link auth + mutation handlers),
`components/` 79.66% lines (`RecurringSeriesSection` 60/21, `DueTimeField` 63, `AssignmentFormModal` 64),
and `useAssignments.js` branches 80.18%. `supabase.js` (0%, module-scope env throw) and `uuid.js`
(14%, crypto-fallback path) are intentionally low and can be `exclude`d or given targeted tests.

**Note on suite speed & a CI reliability risk (observed while landing this fix):**
- Warm-cache `test:ci` is **~6 s**; **cold-cache** (any config change, and *every* CI run on a fresh
  runner) is **~7 min** wall-clock, dominated by the one-time babel/metro transform.
- **Intermittent 0%-CPU hang on cold start.** The Node 22+ worker-handshake hang the config header
  documents still fires occasionally on a cold coverage run — the fork stalls at ~0% CPU and the run
  never finishes until killed; a plain retry succeeds. Observed once while landing this change.
- **CI exposure:** `.github/workflows/test.yml` runs `test:ci` cold and has **no `timeout-minutes`**,
  so a hung run inherits GitHub's 6 h default. **Recommended follow-up (small, high-value):** add
  `timeout-minutes: ~15` to that job and cache `.vitest-cache` between runs (turns most CI runs warm
  and caps a hang). This is a CI-hardening item, tracked in the checklist below.

---

## 7. Latent bugs / fragile spots to fix in Phase 2 (test-first)

Sourced from the code's own comments plus review of the concurrency paths. Confirm each with a failing
test before the fix (this doubles as the Phase-1 coverage work).

1. **Map lost-update across per-user maps.** `useAssignments`' per-*id* queue does **not** serialize
   writes to the per-*user* `reminder_ids_${userId}` / `calendar_events_${userId}` maps; the two
   orchestration hooks each add their own `withMapLock`. This is correct today but *duplicated* and
   easy to break — one refactor target is a single shared lock. Add tests that interleave a
   `reconcileOnLoad` and a same-tick `scheduleFor` for a *different* id and assert no entry is dropped.
2. **iOS 64-slot budget overrun** under concurrent single-schedules (each reads the same pending count).
   Batch paths share a budget; the single-shot path uses `reservedSlots`. Add a test that schedules
   near the cap from parallel `insert`s and asserts the cap+headroom is respected.
3. **Android reminder trigger path.** `scheduleRemindersForBudget` uses a DATE trigger on Android and
   CALENDAR on iOS; TZ changes on Android rely entirely on the AppState reschedule. Add explicit
   Android-platform tests (mock `Platform.OS`) for both the schedule and the TZ-change reschedule.
4. **Reminder-map format migration.** Legacy `string[]` vs new `{ids, sig}` entries co-exist. Cover
   `loadReminderMap` dropping malformed entries, and a first-post-migration edit rescheduling on sig
   mismatch.
5. **Account-switch with no intervening null.** `useAssignments`' load effect wipes user-scoped state
   unconditionally *because* its dep array is userId-stable. Add a regression test: switch userId A→B
   directly (deep-link path), fetch for B fails, assert screen is empty/error — never A's rows. Also
   add a guard test that fails loudly if the effect's deps ever gain a non-userId-stable value.
6. **`removeSeries` closure staleness.** It reads `assignments` from closure to compute series ids; if
   the dep array drifts in a refactor this silently deletes the wrong set. Lock the current behavior
   with a test before splitting the hook.

---

## 8. Refactor plan (Phase 2, ordered)

Each step: **(a)** ensure Phase-1 tests cover the touched behavior, **(b)** refactor with the suite
green throughout, **(c)** self-score, fix > 49, re-review.

1. **Fix the latent bugs in §7** — smallest diffs, highest safety value, no structural change.
2. **`lib/mutationGuards.js`** — pull `selfMutations`, `tombstones`, `enqueueForId`, `isOwnEcho` out of
   `useAssignments` into a pure, framework-free module with its own unit tests. The hook keeps a thin
   `useRef` wrapper. *Rationale:* the hardest-to-test logic becomes plain-function testable; branch
   coverage on the race paths gets trivial to reach.
3. **Shared per-user map lock** — one `withUserMapLock(userId, fn)` + a shared "load-modify-save map"
   helper consumed by both orchestration hooks. Removes ~2× duplicated lock + deep-equal logic.
4. **Test-suite performance** — scope `transformIgnorePatterns`/transform to what actually needs metro,
   evaluate pool/threads, or the two-project split from §6. *Rationale:* 3-min plain / >5-min coverage
   is the top DX + CI-cost drag; also the biggest single lever on iteration speed for the rest of Phase 2.
5. **Split `useAssignments.js`** into `useAssignmentsLoad` (hybrid load + lifecycle effects),
   `useAssignmentMutations` (insert/update/remove/series over `mutationGuards`), and a slim composing
   hook. Only after steps 2–3 make the seams obvious.
6. **`App.js` extraction** — `useAuthSession` (bootstrap + auto-refresh) and `useDeepLinkAuth`
   (PKCE/implicit/recovery). Centralize the four duplicated sync-error copy strings.
7. **Component thinning** — move remaining form/validation logic from `AssignmentFormModal` into
   `useAssignmentForm`; keep components presentational.

---

## 9. Risks & dependencies

- **`isolate:true` is load-bearing.** Any test-perf work must preserve it; do not switch to
  `isolate:false` to go faster (documented ~1-in-3 flake). Prefer transform-scoping / project split.
- **Coverage fix is a prerequisite**, not optional: raising gates or claiming UI coverage before §6
  lands is measuring nothing.
- **Refactors touch concurrency + auth** — the two "never downshift" areas. Keep these on Opus, review
  every diff, and never merge a race-path change on green CI alone.
- **CI cost**: `test:ci` (--coverage) is slow; the perf refactor (§8.4) pays for itself in CI minutes.
- **Supabase/expo doubles**: the integration tier depends on the new `fake*` helpers. Land those first
  or the flow tests fragment into per-test mocks again.
- **Behavioral drift**: the last 8 commits are all account-deletion / calendar-cleanup bug fixes.
  Phase 1 must lock these in *before* Phase 2 touches ProfileModal or the orchestration hooks.

---

## 10. Safe implementation order (single track)

1. **§6 coverage-measurement fix** → honest UI numbers. *(Phase 1, unblocks targeting.)*
2. **`fakeSupabase` + `fakeNotifications` helpers.** *(Phase 1, unblocks flow tests.)*
3. **§4 integration flow tests** (create/edit/delete/realtime) + **§7 regression tests** (still failing
   where a real bug exists). *(Phase 1.)*
4. **Fill `useAssignments` + orchestration branch gaps** to ≥ 85%. *(Phase 1.)*
5. **`App.js` / `AuthScreen` / `ProfileModal` UI coverage** to target. *(Phase 1.)*
6. **Raise gates to just-below new actuals; CI coverage summary.** → **Phase 1 done.**
7. **§7 bug fixes** (tests from step 3 now go green). *(Phase 2.)*
8. **`mutationGuards` extraction** → **shared map lock** → **suite perf**. *(Phase 2.)*
9. **Split `useAssignments`** → **`App.js` hook extraction** → **component thinning**. *(Phase 2.)*
10. **Final review loop; self-score; fix > 49; re-review until clean.** → **Phase 2 done.**

---

## 11. Definition of Done

**Phase 1 (Stabilization) is done when:**
- `components/`, `screens/`, `App.js` are line-counted in coverage with real numbers (§6).
- Overall gates raised and green: lines ≥ 93, statements ≥ 90, functions ≥ 89, branches ≥ 85, with
  `useAssignments.js` branches specifically ≥ 85%.
- The 4 critical flows (§4) each have a passing integration test; all §7 regressions have a test that
  is green (bug fixed) or explicitly deferred with a rationale.
- No `react-test-renderer` deprecation / `act()` warnings in the run.
- `npm run test:ci` green in CI; coverage artifact/summary surfaced on the PR.

**Phase 2 (Refactoring) is done when:**
- Every §7 latent bug has a fix backed by a pre-existing failing test.
- `useAssignments.js` no longer owns the raw concurrency primitives (they live in `lib/mutationGuards.js`,
  unit-tested); the two orchestration hooks share one map-lock helper.
- No net coverage regression vs Phase-1 end; all behavior tests unchanged and green.
- Plain suite < 60 s, coverage build < 120 s locally (or a documented reason it can't be).
- Each merged PR self-scored, all findings > 49 addressed, re-reviewed until the reviewer returns empty.
