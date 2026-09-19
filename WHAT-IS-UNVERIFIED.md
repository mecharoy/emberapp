# What was checked, and what wasn't

This port was written on Windows, where iOS code can't be built. A GitHub
Actions macOS runner now does that on every push to the `ios` branch
(`.github/workflows/ios.yml`), so more of it is proven than when it was
written. This file says exactly how much.

## Checked on Windows

| Check | Result |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | passes |
| `npx vitest run` | 370 tests pass, 37 files |
| `npm run build` (tsc + vite) | passes |
| `npx tauri icon src-tauri/icons/icon.png` | ran; 18 iOS icons written |

## Checked on a macOS runner — it builds, and it runs

Xcode 16.4, iphoneos SDK 18.5, on an iPhone 17 Pro simulator running iOS 26.2.

| Check | Result |
|---|---|
| Rust core for `aarch64-apple-ios` (a real iPhone) | **compiles**, `ios_extras.rs` included |
| Every Swift and Objective-C++ file in `ios/`, at its target's iOS version | **passes** |
| `tauri ios init` against this `tauri.conf.json` | **generates the project** |
| `scripts/xcode-extensions.py` + `xcodegen` | **adds the widget and share targets** |
| `tauri ios build --target aarch64-sim` | **builds `Ember.app`** |
| `EmberWidget.appex` and `EmberShare.appex` inside `Ember.app/PlugIns` | **both embedded** |
| The app launches on a simulator | **launches, no crash report** |
| tauri-plugin-sql opens ember.db and migrates it | **all 14 migrations applied** |
| A note written into the inbox while Ember is closed | **reaches the `captures` table on the next launch, and the inbox is emptied** |

That last one is the whole widget / share-sheet / lock-screen-reply mechanism,
end to end on a real iOS runtime: `inbox_drain` in Rust, the zod parse in
TypeScript and the insert. The journal lands at
`Library/Application Support/dev.abhij.ember.ios/ember.db`.

Screenshots and the built app are kept as workflow artifacts for 14 days.

## Still not proven

- **Signing, and a build for a real iPhone.** A simulator build is never
  signed, which is exactly why CI can do it with no Apple account. The Swift
  and the Rust are the same either way, and the Rust is compiled for a device
  separately — what is untested is the signing, and the provisioning profiles
  the App Group needs on a device.
- **The extensions doing their job.** They build and they are embedded, but
  nothing has put the widget on a Home Screen, tapped the Control Centre
  button or shared text to Ember. The App Group has never actually carried a
  note between two processes; CI writes the inbox file itself.
- **Everything a person would touch.** One screen has been seen, in a
  screenshot, once. No conversation, no entry, no reminder, no backup, no
  restore has ever run.

## Where trouble is most likely, roughly in order

1. **The widget and share targets** (`BUILDING-ON-A-MAC.md`, Phase B). Xcode
   has to create the targets by hand and the App Group has to match on all
   four. This is the least certain part of the whole port.
2. **`exclude_from_backup` in `src-tauri/src/ios_extras.rs`.** It sets the
   `com.apple.MobileBackup` extended attribute with `libc::setxattr`, which is
   what `NSURLIsExcludedFromBackupKey` does underneath, rather than calling
   Foundation — that would have meant a new dependency. It compiles (CI builds
   it for a real iPhone), but compiling proves only that it is called, not that
   Apple honours it. If the "Welcome back" screen fails to appear after restoring a phone
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
