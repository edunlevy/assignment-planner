# Phase 22 — Manual Steps Walkthrough

Everything Claude cannot do for you, in order. Assume nothing — every click is listed.

---

## Step 1 — Enroll in the Apple Developer Program ($99/year, 24–48h wait)

1. Open **https://developer.apple.com/programs/** in Safari (Apple's site behaves best in Safari)
2. Click **Enroll** in the top right
3. Sign in with the Apple ID you want associated with your developer account (use a personal one you'll keep — you can't easily transfer apps later)
4. Choose **Individual / Sole Proprietor** (not Organization — that requires a D-U-N-S number and is much harder)
5. Fill in your legal name, address, phone — these become public on the App Store under "Seller"
6. Pay $99 with a credit card
7. **Wait.** Apple verifies your identity in 24–48 hours. You'll get an email when approved. **Do not start step 2 until you receive this email.**

---

## Step 2 — Find your Apple Team ID

1. After approval, log into **https://developer.apple.com/account**
2. In the left sidebar, click **Membership Details**
3. Find the line **Team ID** — it looks like `AB12CD34EF` (10 characters, letters + digits)
4. **Copy this value.** You'll paste it into `eas.json` in Step 5.

---

## Step 3 — Create the App Store Connect record

1. Go to **https://appstoreconnect.apple.com**
2. Sign in with the same Apple ID
3. Click **My Apps**
4. Click the blue **+** button → **New App**
5. Fill in the dialog:
   - **Platforms:** check ☑ iOS
   - **Name:** `Assignment Planner` (this appears in the App Store)
   - **Primary Language:** English (U.S.)
   - **Bundle ID:** select `com.elliedunlevy.assignmentplanner` from the dropdown. **If it's not there**, you need to register it first at https://developer.apple.com/account/resources/identifiers/list → blue **+** → App IDs → App → Description: "Assignment Planner", Bundle ID: Explicit → `com.elliedunlevy.assignmentplanner` → Continue → Register. Then come back here and the dropdown will include it.
   - **SKU:** `assignmentplanner-001` (internal only, never shown publicly)
   - **User Access:** Full Access
6. Click **Create**

---

## Step 4 — Find your numeric App Store Connect App ID

1. You're now on the app's overview page in App Store Connect
2. Look at the URL bar — it looks like `https://appstoreconnect.apple.com/apps/1234567890/...`
3. **The number between `/apps/` and the next `/` is your `ascAppId`.** Copy it.

---

## Step 5 — Fill in `eas.json` with your two IDs

Open `eas.json` in the repo and replace the empty strings:

```json
"submit": {
  "production": {
    "ios": {
      "appleId": "eadunlevy@gmail.com",
      "ascAppId": "1234567890",       ← paste from Step 4
      "appleTeamId": "AB12CD34EF"     ← paste from Step 2
    }
  }
}
```

Commit on a small branch (`phase-22-eas-credentials`) and open a PR. Don't combine with other changes — this is the single most error-prone line in the whole submission.

---

## Step 6 — Run the Supabase migration for account deletion

(See the **PR for `phase-22h-account-deletion`** — that PR creates `db/migrations/2026-05-18_delete_user.sql`.)

1. Go to **https://supabase.com/dashboard**
2. Open your Assignment Planner project
3. In the left sidebar, click **SQL Editor**
4. Click **+ New query**
5. Open `db/migrations/2026-05-18_delete_user.sql` in the repo, copy the entire contents
6. Paste into the SQL Editor
7. Click **Run** (bottom right, or ⌘↵)
8. You should see "Success. No rows returned."
9. To verify: click **Database** → **Functions** in the left sidebar. You should see `delete_user` in the list with `security definer`.

---

## Step 7 — Capture screenshots

You need at least one device size. Easiest is the 6.7" iPhone simulator.

### From Xcode Simulator (recommended)

```bash
# In Terminal, from anywhere:
xcrun simctl list devices | grep "iPhone 15 Pro Max"
# Note the device ID, then:
xcrun simctl boot "iPhone 15 Pro Max"
open -a Simulator
```

Then from `~/Desktop/Summer2026work/assignment-planner`:
```bash
npx expo start --ios
```

Press `i` in the Expo terminal to open in the simulator. The app builds and launches.

In the simulator, sign in with a real test account (create one fresh — don't use your main account), then navigate to each screen:

1. **List view** — make sure you have 4–6 sample assignments. Press **⌘S** in the Simulator to save a screenshot to Desktop.
2. **Calendar view** — tap the List/Calendar toggle. Press ⌘S.
3. **Add modal with date picker open** — tap +, fill in name/course, tap the date field. Press ⌘S.
4. **Recurring assignment** — toggle "Repeat weekly", show the end-date picker. Press ⌘S.

Rename and move the files into the repo:
```bash
cd ~/Desktop/Summer2026work/assignment-planner/marketing/screenshots
mv ~/Desktop/"Simulator Screenshot - iPhone 15 Pro Max - "*.png .
# rename to: 6.7in-01-list-view.png, 6.7in-02-calendar-view.png, etc.
```

### iPad screenshots — do this OR change `supportsTablet` to `false`

Right now `app.json` has `"supportsTablet": true`. Apple will require iPad screenshots (2048×2732). If you don't want to support iPad, edit `app.json`:
```json
"ios": {
  "supportsTablet": false,
  ...
}
```
This is a real decision — the app does work on iPad, but the layout isn't optimized. **Recommended for v1: set to false, optimize iPad in a later release.** If you keep `true`, repeat Step 7 with the "iPad Pro 12.9-inch (6th generation)" simulator.

---

## Step 8 — Deploy the privacy policy

1. Merge **PR #2 in `assignment-planner-web` repo** (the one this session opened) into `phase-21-web-hosting`
2. Merge `phase-21-web-hosting` into `main` (if not already merged)
3. Go to https://github.com/edunlevy/assignment-planner-web/settings/pages
4. Under **Source**, select: **Deploy from a branch** → Branch: `main` / Folder: `/ (root)` → **Save**
5. Wait 60 seconds, then open https://edunlevy.github.io/assignment-planner-web/privacy.html in a browser
6. Confirm it loads with the expected content

---

## Step 9 — Fill in App Store Connect metadata

Go to https://appstoreconnect.apple.com → My Apps → Assignment Planner → **App Information** in the left sidebar:

- **Subtitle:** `Track deadlines, stay on top` (or your edit)
- **Category — Primary:** Productivity
- **Category — Secondary:** Education (optional)
- **Content Rights:** check ☑ "Does not contain, show, or access third-party content"
- **Age Rating:** click **Edit** → answer everything "None" → 4+ should result
- **Privacy Policy URL:** `https://edunlevy.github.io/assignment-planner-web/privacy.html`
- **Subscription:** N/A (you have none)

Then click **App Privacy** in the left sidebar → **Get Started**. Paste from `marketing/store-copy.md` → "Privacy Nutrition Labels" section. The questionnaire asks:
- "Do you or your third-party partners collect data from this app?" → **Yes**
- Select **Contact Info** → **Email Address** → check ☑ used for "App Functionality" → linked to user ☑ → not used for tracking
- Select **User Content** → **Other User Content** → "App Functionality" → linked to user ☑ → not used for tracking
- Save

Then **Pricing and Availability** → set to **Free**, all territories selected.

Then **App Store** → **iOS App** → **1.0 Prepare for Submission**:
- **Promotional text** (170 chars, optional): "New: rolling date picker and full-month calendar view to plan your week at a glance."
- **Description:** paste from `marketing/store-copy.md`
- **Keywords:** paste from `marketing/store-copy.md`
- **Support URL:** `https://edunlevy.github.io/assignment-planner-web/`
- **Marketing URL:** `https://edunlevy.github.io/assignment-planner-web/` (or leave blank)
- **Screenshots:** drag the files from `marketing/screenshots/` into the 6.7" slot
- **App Review Information** at the bottom: fill in your name, phone, email; create a real test Supabase account, write its credentials into the **Sign-In Information** fields; **Notes:** paste from `marketing/store-copy.md`

---

## Step 10 — Build with EAS

```bash
cd ~/Desktop/Summer2026work/assignment-planner
# First time on a new machine — log into EAS:
npx eas-cli@latest login
# Build:
npx eas-cli@latest build --platform ios --profile production
```

The CLI will ask:
- "Generate a new Apple Distribution Certificate?" → **Yes** (first time only)
- "Generate a new Apple Provisioning Profile?" → **Yes** (first time only)
- "Apple ID:" `eadunlevy@gmail.com` (enter your password when prompted)
- "Push Notifications Key" — say **Yes, generate one** even if you only use local notifications today; saves you a step if you ever add push

EAS will build for ~20–30 minutes. You'll get an email and a CLI link when done.

---

## Step 11 — Submit to TestFlight

```bash
npx eas-cli@latest submit --platform ios --latest
```

This uploads the build to App Store Connect. Processing takes 15–60 minutes. You'll see it appear under **TestFlight** → **Builds** in App Store Connect.

Once processed:
1. App Store Connect → TestFlight → **Internal Testing** → click your default group
2. Click the **+** next to Builds → select the build → Add
3. The build is immediately available to you and any internal testers
4. Install the **TestFlight** app from the App Store on your iPhone
5. Open it — your build appears. Tap **Install**.
6. **Test everything:** signup, email confirm, add assignment, edit, delete, recurring, notifications fire, deep links work, **account deletion works.**

---

## Step 12 — External testing (optional but recommended)

1. App Store Connect → TestFlight → **External Testing** → **+** → create a group "Friends"
2. Add 2–5 email addresses
3. Submit the build for **Beta App Review** — Apple reviews external builds (usually < 24h)
4. Once approved, testers get an email with a TestFlight code

Skip this and go to Step 13 if you only want yourself testing.

---

## Step 13 — Submit for App Store review

1. App Store Connect → My Apps → Assignment Planner → **App Store** → **1.0 Prepare for Submission**
2. Scroll to **Build** → click **+ Build** → select your TestFlight build
3. Scroll to **Version Release** → choose **Manually release this version** (safer for v1)
4. **Encryption export compliance:** Already handled by `usesNonExemptEncryption: false` in `app.json` — no question shown
5. Click **Add for Review** (top right) → **Submit to App Review**
6. Apple reviews in 24h–3 days. You'll get an email with the decision.

---

## Step 14 — If Apple rejects

Common rejections and fixes:
- **"Missing privacy policy"** → re-check the URL loads, that it covers all data you collect
- **"Demo account doesn't work"** → log in with the credentials you provided; fix and update App Review Information
- **"No way to delete account"** → Phase 22h's account-deletion code must actually be merged + included in the build
- **"App looks like a website"** → make sure screenshots showcase the native date picker, calendar view, and notifications
- **"Bug X"** → fix, bump build number (EAS does it automatically with `autoIncrement: true`), `eas build`, `eas submit`, reply to the rejection in App Store Connect's Resolution Center

Rejection is normal on first submission. Address feedback, resubmit. The review queue clears quickly the second time.

---

## Quick reference: which Claude session does each phase

When you come back to do any of these, mention the phase and Claude can pick up:

| Phase | Branch | What |
|---|---|---|
| 22a (this session) | `phase-22-app-store` | Marketing scaffold, app.json encryption flag |
| 22h (this session) | `phase-22h-account-deletion` | In-app Delete Account |
| 22-eas-credentials | new branch when ready | Fill `eas.json` after Apple Developer enrollment |
| 22-screenshots | new branch | Drop captured PNGs into `marketing/screenshots/` |
| 22-supports-tablet | optional small PR | Flip `supportsTablet` to `false` if not doing iPad |
