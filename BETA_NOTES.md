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

---

## Bugs fixed during beta

Track each one here, with the commit hash, so we have a history.

| Date | Reporter | Issue | Commit |
|---|---|---|---|
| | | | |
