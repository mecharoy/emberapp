# What was checked, and what wasn't

This port was written on Windows. iOS builds only on macOS, so a large part of
it has never been compiled, let alone run. This file says exactly which part,
so nobody has to guess.

## Checked, on Windows

| Check | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | passes |
| `npx vitest run` | 370 tests pass, 37 files |
| `npm run build` (tsc + vite) | passes; web bundle written to `dist/` |
| `npx tauri icon src-tauri/icons/icon.png` | ran; 18 iOS icons written |
| JSON configs parse (`tauri.conf.json`, `capabilities/default.json`) | valid |

The new pure logic has tests of its own: `src/dayReminders.test.ts` (which of
the three reminders ring on which days, the notification ids they use) and
`src/inbox.test.ts` (reading the lines the widget and the share sheet write).

## Not checked — nothing here has been compiled

- **All Rust.** `cargo check --target aarch64-apple-ios` needs the iOS SDK,
  which only exists on a Mac. `src-tauri/src/ios_extras.rs` is new and entirely
  unbuilt.
- **All Swift.** Five files in `ios/`. Never compiled, never run.
- **The Xcode project.** `src-tauri/gen/apple/` does not exist; `tauri ios init`
  makes it on the Mac.
- **Anything visual.** Safe areas, the keyboard, the sheet, the tab bar.

## Where trouble is most likely, roughly in order

1. **The widget and share targets** (`BUILDING-ON-A-MAC.md`, Phase B). Xcode
   has to create the targets by hand and the App Group has to match on all
   four. This is the least certain part of the whole port.
2. **`exclude_from_backup` in `src-tauri/src/ios_extras.rs`.** It sets the
   `com.apple.MobileBackup` extended attribute with `libc::setxattr`, which is
   what `NSURLIsExcludedFromBackupKey` does underneath, rather than calling
   Foundation — that would have meant a new dependency I couldn't compile to
   check. If the "Welcome back" screen fails to appear after restoring a phone
   from an iCloud backup (the manual check in `BUILDING-ON-A-MAC.md`), this is
   why, and the fix is to call the Foundation API from `EmberLaunch.swift`
   instead.
3. **Day reminders with a text field.** `registerActionTypes({ input: true })`
   is documented as supported on mobile by tauri-plugin-notification v2, but
   the exact shape of what `onAction` hands back on iOS is read defensively in
   `handleDayReminderAction` and may need adjusting against the real payload.
4. **The two places a reply can be handled.** While Ember is on screen the
   plugin's own `onAction` saves it; while it isn't,
   `EmberNotificationHandler.swift` writes it to the inbox instead. They tell
   the two cases apart by `UIApplication.shared.applicationState`. If a reply
   ever shows up twice in a check-in, that test is the thing to look at.
5. **The keyboard under the quick-note sheet.** `BUILDING-ON-A-MAC.md` has the
   one-line native fix if it doesn't rise on its own.

## What was deliberately dropped

| Android | Why it isn't here |
|---|---|
| The always-there note in the notification drawer | iOS has no equivalent. The Settings toggle for it is gone. |
| Quick Settings tile | Replaced by the Control Centre button (iOS 18+). |
| Restart after restoring a backup | iOS apps may not restart themselves. Ember asks the user to reopen it. |
| Pairing with Ember on a computer | Deliberately left out of this edition — see the end of `BUILDING-ON-A-MAC.md`. Three AI providers, not four. |
