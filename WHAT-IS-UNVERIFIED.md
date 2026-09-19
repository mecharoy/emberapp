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
| The same, through the App Group folder | **not proven** — the simulator grants no App Group without a provisioning profile; CI says so each run rather than guessing |

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

1. **A day reminder answered while Ember is closed.** The reminders are
   scheduled in TypeScript and a reply is handled by
   tauri-plugin-notification's own `onAction`, which `src/dayReminders.ts`
   listens to. Whether iOS delivers that to a webview that isn't running yet is
   the open question. There is no second handler to fall back on: a Tauri iOS
   app has no AppDelegate to install one from, and the one that was written for
   the job is in `trash/ios-no-appdelegate/` with an explanation. If cold-start
   replies turn out to be lost, the fix is a proper Tauri iOS plugin.
2. **`exclude_from_backup` in `src-tauri/src/ios_extras.rs`.** It sets the
   `com.apple.MobileBackup` extended attribute with `libc::setxattr`, which is
   what `NSURLIsExcludedFromBackupKey` does underneath, rather than taking on a
   Foundation binding. It compiles, and CI builds it for a real iPhone, but
   compiling proves only that it is called — not that Apple honours it. If the
   "Welcome back" screen fails to appear after restoring a phone from an iCloud
   backup (the manual check in `BUILDING-ON-A-MAC.md`), this is why, and the
   fix is to call the Foundation API from `ios/App/EmberBootstrap.mm`, which is
   already Objective-C++ and already runs early enough.
3. **The shape of what `onAction` hands back on iOS.**
   `registerActionTypes({ input: true })` is documented as supported on mobile,
   but `handleDayReminderAction` reads the payload defensively and may need
   adjusting against the real thing.
4. **The App Group, and so the extensions doing their job.** They build, they
   carry the entitlement, and they are embedded in `Ember.app/PlugIns`. But an
   App Group is granted by a provisioning profile, and an unsigned simulator
   build has none — CI reports, every run, that the simulator creates no
   container for `group.dev.abhij.ember.ios`. So the folder that carries a note
   from an extension to the app has never actually carried one; Ember fell back
   to its own folder in every test, which is exactly why they passed. On a
   device with a profile that grants the group this should work, and it is the
   first thing on the by-hand checklist.
5. **The keyboard under the quick-note sheet.** `BUILDING-ON-A-MAC.md` has the
   one-line native fix if it doesn't rise on its own.

## What was deliberately dropped

| Android | Why it isn't here |
|---|---|
| The always-there note in the notification drawer | iOS has no equivalent. The Settings toggle for it is gone. |
| Quick Settings tile | Replaced by the Control Centre button (iOS 18+). |
| Restart after restoring a backup | iOS apps may not restart themselves. Ember asks the user to reopen it. |
| Pairing with Ember on a computer | Deliberately left out of this edition — see the end of `BUILDING-ON-A-MAC.md`. Three AI providers, not four. |
