# Beta Testing Notes

Tracker for Phase 14 — internal distribution beta. Update this file as feedback comes in.

---

## How to share the app with a new tester

### iOS tester
1. Ask them to visit [udid.io](https://udid.io) on their iPhone and send you their UDID
2. Add the UDID at [developer.apple.com](https://developer.apple.com) → Certificates, Identifiers & Profiles → Devices
3. Rebuild so the provisioning profile includes the new device:
   ```bash
   eas build --platform ios --profile preview
   ```
4. Send the install link from the EAS build dashboard
5. First-time installs: tester goes to Settings → General → VPN & Device Management → trust the developer certificate

### Android tester
1. Build once:
   ```bash
   eas build --platform android --profile preview
   ```
2. Send the EAS download link — the file is a `.apk`
3. They may need to enable "Install from unknown sources" the first time

---

## Tester checklist (copy-paste into a message to each tester)

```
Hi! Thanks for testing Assignment Planner.

Please try each of these and reply with anything broken, confusing, or missing.

Core flows:
[ ] Sign up with a new email address
[ ] Log in and log out
[ ] Add 3 assignments with different due dates and importance levels
[ ] Edit one assignment (change the title and status)
[ ] Delete one assignment
[ ] Add a weekly recurring assignment (3–4 weeks)
[ ] Mark an assignment as completed — check it moves to the bottom
[ ] Close the app completely and reopen — check assignments are still there
[ ] Sign out and sign back in — check assignments reload correctly

Reminders:
[ ] On first login, allow notifications when prompted
[ ] Add an assignment due tomorrow — you should get a reminder
[ ] If you denied notifications initially, go to Settings → Assignment Planner → Notifications → enable, then sign out and back in — reminders should start working

Password reset:
[ ] Tap "Forgot password" on the login screen
[ ] Check your email, tap the reset link
[ ] Confirm the "Set New Password" modal appears in the app
[ ] Set a new password, then sign out and sign back in with it

Account deletion:
[ ] Tap Account → Delete Account → confirm
[ ] Verify you're returned to the sign-in screen
[ ] Try signing in with the deleted account — it should fail

General:
[ ] Try on Wi-Fi and on mobile data
[ ] Screenshot anything that looks broken or confusing
```

---

## Tester checklist — 2026-08 TestFlight build (calendar sync, filters, recurrence)

Copy-paste for testers on the build that adds calendar sync, filtering, and
the recurrence overhaul. The calendar section matters most — it exercises
the permission edge that caused the original sync bug and is the one part
that could not be fully verified off-device.

```
Hi! This build adds calendar sync, filters, and much better repeating
assignments. Please try each of these and reply with anything broken,
confusing, or unexpected.

Calendar sync (please test this first):
[ ] Account -> turn on "Sync to Calendar" -> choose FULL ACCESS when iOS asks
[ ] Open the Apple Calendar app — there should be a new "Assignment Planner"
    calendar with an event for every assignment
[ ] Add a new assignment — it should appear in Calendar
[ ] Change an assignment's due date — the event should move
[ ] Extra credit: turn sync off, then on again, but this time pick
    "Add Events Only" at the permission prompt — the app should explain it
    needs Full Access and offer an "Open Settings" button that works

Filtering:
[ ] Use the new chip bar: filter by class, by Overdue / Today / This week,
    and by Short / Medium / Long — try combining them
[ ] Tap Clear to reset
[ ] While filtering, the "Work on next" card and the "N remaining" count
    should NOT change — that is intentional

Repeating assignments — creating:
[ ] Create a repeating assignment on specific weekdays (e.g. Mon + Wed + Fri)
[ ] Create a monthly one, and one that repeats "After N times" instead of
    ending on a date
[ ] Check the generated occurrences land on the days you expect
[ ] Oddball: a monthly assignment due on the 31st — months without a 31st
    should be SKIPPED, not moved to the 30th

Repeating assignments — editing:
[ ] Edit one occurrence, choose "Just this one" — only that one changes
[ ] Edit another, choose "This & future" — that one and everything after it
    changes; moving the due date 2 days should shift every later occurrence
    by 2 days; earlier occurrences must be untouched
[ ] Mark an occurrence completed, then do a "This & future" edit from an
    EARLIER occurrence — the completed one should stay completed

Reminders (regression check):
[ ] Add an assignment due about an hour from now with a due time — the
    reminder notification should arrive

Report: crashes, any "Could not..." error message (screenshot it — exact
wording matters), and any occurrence or calendar event on a day you did not
expect.
```

---

## Active testers

| Name | Platform | UDID added | Build sent | Notes |
|---|---|---|---|---|
| _add here_ | iOS / Android | YYYY-MM-DD | YYYY-MM-DD | |

---

## Feedback log

Add a new dated entry as feedback comes in. Tag each with `bug`, `confusion`, or `idea`.

### YYYY-MM-DD — Tester name
- **[bug]** Description of the issue
- **[confusion]** Description of what didn't make sense
- **[idea]** Description of the suggestion

---

## Known issues (carryover from earlier reviews)

- **Reminder IDs are device-local only.** If a tester reinstalls the app or signs in on a second device, the app cannot cancel old reminders by ID (they're cleared on sign-out and rescheduled on next login, which mitigates this for the normal flow). Optional Supabase migration in `NOTES.md`.
- **Expo Go cannot reliably test notifications.** That's why internal distribution exists — notifications only work properly in real builds.
- **iOS first launch requires trusting the developer certificate.** Settings → General → VPN & Device Management.
- **Play Store release prerequisite:** the app declares `SCHEDULE_EXACT_ALARM` and `USE_EXACT_ALARM` (exact reminder delivery on Android 12+). Any future Google Play submission must complete the Play Console "Exact alarm" declaration form, or the release can be blocked.

---

## Bugs fixed during beta

Track each one here, with the commit hash, so we have a history.

| Date | Reporter | Issue | Commit |
|---|---|---|---|
| | | | |
