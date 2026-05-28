# Social Login Plan — Sign in with Google + Sign in with Apple

Pick this up in a new chat. Hand this file to Claude and say "implement this plan."
Recommended model: **Claude Sonnet 4.6** for the code edits, **Claude Haiku 4.5**
for the manual-checklist sections.

Prereq: Part 1 (email confirmation fix) must already be working in TestFlight
before starting this work.

---

## Why the native ID-token flow (not web OAuth)

For an Expo iOS app talking to Supabase, the cleanest path is **native SDKs that
yield an ID token, then `supabase.auth.signInWithIdToken`** — *not* the OAuth
web flow. The web flow works but pops a Safari sheet and depends on deep-link
callbacks, which is the flaky thing we just fixed. Native ID-token flow:

- **Apple:** `expo-apple-authentication` → returns an Apple ID token + nonce →
  `supabase.auth.signInWithIdToken({ provider: 'apple', token, nonce })`.
- **Google:** `@react-native-google-signin/google-signin` → returns a Google ID
  token → `supabase.auth.signInWithIdToken({ provider: 'google', token })`.

Both bypass `emailRedirectTo` entirely — no deep link needed for auth. The
existing password-reset and email-confirm deep link handlers in `App.js` stay
untouched.

---

## Required packages

```bash
npx expo install expo-apple-authentication
npx expo install @react-native-google-signin/google-signin
```

Both require a custom dev client or production build — they **do not work in
Expo Go**.

---

## App Store review requirement (read this first)

**Apple Guideline 4.8** requires Sign in with Apple to be offered alongside any
third-party social login (Google, Facebook, etc.). Some readings allow exemption
if you also have a first-party email/password option (which we do), but in
practice reviewers still flag Google-only apps. **Ship Apple + Google together.
Do not ship Google alone.**

---

## Manual setup steps (must do yourself, before code)

### A. Apple Developer setup

1. Go to https://developer.apple.com/account → **Certificates, Identifiers
   & Profiles → Identifiers**.
2. Click your App ID `com.elliedunlevy.assignmentplanner`.
3. Check the box for **Sign In with Apple**. Click **Save**.
4. If prompted, click **Configure** next to Sign in with Apple → "Enable as a
   primary App ID" → Save.
5. Regenerate the provisioning profile so the new entitlement is included:
   ```bash
   cd ~/Desktop/Summer2026work/assignment-planner
   npx eas-cli@latest credentials
   ```
   Pick iOS → production → "Provisioning Profile" → "Set up a new provisioning
   profile" (let EAS regenerate it). Repeat for the `preview` profile if you
   have one.
6. App Store Connect needs nothing extra now. At submission time you'll answer
   "Yes, uses Sign in with Apple."

### B. Google Cloud OAuth setup

1. Go to https://console.cloud.google.com.
2. Create a new project (top-left dropdown → **New Project** → name it
   "Assignment Planner"). Wait for it to provision.
3. **APIs & Services → OAuth consent screen**:
   - User Type: **External** → Create.
   - App name: `Assignment Planner`
   - User support email: your email
   - Developer contact email: your email
   - Click **Save and Continue** through Scopes (no changes needed), Test users
     (add your own email for testing), and Summary.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **iOS**
   - Name: `Assignment Planner iOS`
   - Bundle ID: `com.elliedunlevy.assignmentplanner`
   - Click **Create**.
5. Copy the resulting **iOS client ID** — looks like
   `123456789-abc123.apps.googleusercontent.com`. Save it.
6. The **reversed client ID** (used as a URL scheme in iOS) is the same string
   reversed: `com.googleusercontent.apps.123456789-abc123`. Save this too.
7. (Optional, only if you ever want web Google sign-in): create a **Web**
   OAuth client ID and paste its client ID + secret into Supabase's Google
   provider config later.

### C. Supabase provider setup

1. https://supabase.com/dashboard → your project → **Authentication →
   Sign In / Providers**.
2. **Apple**:
   - Toggle to **Enabled**.
   - "Authorized Client IDs (for native sign in)": add
     `com.elliedunlevy.assignmentplanner` (your iOS bundle ID).
   - Leave "Services ID" and "Secret Key" empty — those are for web OAuth only.
   - Save.
3. **Google**:
   - Toggle to **Enabled**.
   - "Authorized Client IDs (for native sign in)": paste the iOS client ID from
     Google Cloud step B.5.
   - Leave web client ID/secret empty unless you want web OAuth.
   - Save.

---

## Code changes

### 1. `app.json`

- Add `"expo-apple-authentication"` to the `plugins` array.
- Add the Google sign-in plugin with the reversed client ID:
  ```json
  [
    "@react-native-google-signin/google-signin",
    { "iosUrlScheme": "com.googleusercontent.apps.<reversed-id-from-step-B.6>" }
  ]
  ```
- Under `ios`, add `"usesAppleSignIn": true`.
- Bump `ios.buildNumber` (e.g. from `"1"` to `"2"` — or whatever the latest
  TestFlight build was, +1).

### 2. `lib/socialAuth.js` (new file)

Two helper functions to keep `AuthScreen.js` lean:

- `signInWithApple()` → calls `AppleAuthentication.signInAsync({ requestedScopes: [FULL_NAME, EMAIL], nonce })`, generates a SHA-256 nonce, calls `supabase.auth.signInWithIdToken({ provider: 'apple', token: identityToken, nonce: rawNonce })`. Apple returns a hashed nonce in the token, so you pass the raw nonce alongside.
- `signInWithGoogle()` → calls `GoogleSignin.configure({ iosClientId: '<iOS client ID>' })`, then `GoogleSignin.hasPlayServices()`, then `GoogleSignin.signIn()` → reads `idToken` from the result → calls `supabase.auth.signInWithIdToken({ provider: 'google', token: idToken })`.

Throw on failure; let `AuthScreen.js` show the error.

### 3. `screens/AuthScreen.js`

Below the existing "Create Account" / "Log In" button, add:

- An "or continue with" divider (gray line + centered text).
- **Sign in with Apple** button — use `<AppleAuthentication.AppleAuthenticationButton />` with the official Apple style (required by Apple HIG). Wrap in `Platform.OS === 'ios' && AppleAuthentication.isAvailableAsync()` so it only shows where supported.
- **Continue with Google** button — white background, dark text, Google "G" icon to the left. Follow Google's branding guidelines (do not restyle).

Each handler:
1. Set `loading = true`, clear messages.
2. Call the helper from `lib/socialAuth.js`.
3. On success: do nothing — `onAuthStateChange` in `App.js` will fire SIGNED_IN and unmount `AuthScreen`.
4. On failure: setError with the message. Treat user-cancel (Apple: `ERR_REQUEST_CANCELED`, Google: `statusCodes.SIGN_IN_CANCELLED`) as silent — no error banner.

### 4. `App.js` — no changes

Native ID-token flow doesn't use deep links. The existing handler for
reset-password and confirm stays as-is.

### 5. `lib/supabase.js` — no changes

### 6. `eas.json`

If you don't already have a `development` profile with `developmentClient: true`,
add one. You'll need a dev client to test these locally — Expo Go can't load
native modules.

---

## Files that will change

- `app.json` — plugins, `usesAppleSignIn`, Google URL scheme, build number bump
- `screens/AuthScreen.js` — two new buttons + handlers
- `lib/socialAuth.js` — new file
- `package.json` / `package-lock.json` — two new deps
- `eas.json` — possibly add development profile
- `marketing/manual-steps.md` — append App Store Privacy / "Sign in with Apple" answers

---

## Testing checklist

### Simulator
- Apple sign-in: works in iOS Simulator if you've signed into the simulator's Settings → Apple ID.
- Google sign-in: **does NOT work in plain Expo Go**. Requires either:
  - `npx expo prebuild && npx expo run:ios` (one-time native build), OR
  - `eas build --profile development --platform ios` → install dev client on device.

### Physical device (dev client)
- [ ] Fresh Apple sign-in → new row in `auth.users` with provider `apple`.
- [ ] Test "Hide my email" → Apple returns a private relay address; verify reminders/notifications still work.
- [ ] Fresh Google sign-in → Google consent screen → returns to app → new row in `auth.users` with provider `google`.
- [ ] Sign out, sign back in with same Apple ID → same `user.id` returned (no duplicate row).
- [ ] Sign out, sign back in with same Google account → same `user.id`.
- [ ] Existing email/password account with same email as Google → confirm Supabase's identity-link behavior matches expectation (by default does NOT auto-link).
- [ ] Cancel Apple flow halfway → no error banner shown.
- [ ] Cancel Google flow halfway → no error banner shown.
- [ ] Toggling between Email/Apple/Google all eventually land on the assignments list.

### TestFlight build
- [ ] Bump `buildNumber` in `app.json`.
- [ ] `npx eas-cli@latest build --platform ios --profile production`
- [ ] `npx eas-cli@latest submit --platform ios --latest`
- [ ] Install via TestFlight on a clean device.
- [ ] Repeat all the device tests above through the TestFlight install.
- [ ] If Apple sign-in fails silently → provisioning profile likely missing the entitlement; redo Apple Developer step A.5.

---

## App Store Connect changes at submission time

- **App Information → Sign in with Apple:** Yes.
- **App Privacy:** add "Name" and "Email" to the data-collection list (linked to user, app functionality, not tracking). Apple and Google sign-in expose these by default.
- **Screenshots:** include at least one shot of the auth screen showing both social login buttons.

---

## Open questions to resolve while implementing

1. **Identity linking:** should an existing email/password user be able to also log in via Google with the same email and have it map to the same Supabase user? Supabase's default is to create a separate user. If you want auto-link, enable "Auto-link identities" in Supabase Auth settings (with the security caveats documented there).
2. **Display name:** Apple and Google both return a name. Decide whether to store it on the user's profile or ignore it.
3. **Sign-out from Google:** call `GoogleSignin.signOut()` alongside `supabase.auth.signOut()` so the next press of "Sign in with Google" re-prompts the account chooser. Otherwise it silently re-signs the same account.
