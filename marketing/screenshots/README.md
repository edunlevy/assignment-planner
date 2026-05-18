# Screenshot Specifications

Apple requires screenshots for at least one device size. Capture them from a physical device or Xcode Simulator.

## Required sizes

| Device | Pixels | Required |
|---|---|---|
| 6.7" iPhone (15 Pro Max, 14 Plus) | 1290 × 2796 | **Yes — required** |
| 6.5" iPhone (11 Pro Max, Xs Max) | 1242 × 2688 | Strongly recommended |
| iPad Pro 12.9" (6th gen) | 2048 × 2732 | Required if `supportsTablet: true` |

`app.json` has `supportsTablet: true` — either add iPad screenshots or change it to `false` before submitting.

## Screens to capture (in order)

1. **List view — main screen**
   Show 4–6 assignments with varied due dates, courses, and priorities. The "Work on next" banner should be visible.

2. **Calendar view**
   Show a month with dots on several days. One day selected, filtered list below.

3. **Add assignment modal**
   Date picker open (rolling spinner). Shows name, course, and date fields filled in.

4. **Recurring assignment setup**
   The repeat toggle on, end-date picker visible.

5. **Profile / Sign in screen** (optional)
   Shows the clean auth screen or profile sheet.

## How to capture

### From Xcode Simulator
```bash
# Boot a 6.7" simulator
xcrun simctl boot "iPhone 15 Pro Max"
open -a Simulator
# Run the app
npx expo run:ios --device "iPhone 15 Pro Max"
# Take screenshot (Cmd+S in Simulator, or:)
xcrun simctl io booted screenshot ~/Desktop/screenshot-01.png
```

### From a physical device
- Run `eas build --platform ios --profile preview` to get a TestFlight-able build
- Install on device, navigate to each screen, take screenshot with Side Button + Volume Up
- AirDrop or sync to Mac, rename and place in this directory

## File naming
```
screenshots/
  6.7in-01-list-view.png
  6.7in-02-calendar-view.png
  6.7in-03-add-modal.png
  6.7in-04-recurring.png
  6.5in-01-list-view.png   (optional)
  ipad-01-list-view.png    (required if supportsTablet: true)
```

## Upload
Screenshots are uploaded directly in App Store Connect → App Store → Screenshots. They are not submitted via EAS.
