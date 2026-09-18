# Ember for iPhone — port design

Date: 2026-09-19
Source: `ember-mobile` (Android, Tauri 2), cloned at commit c07ea5e.

## Goal

An iOS edition of Ember in its own folder, `ember-ios`, sharing the whole
React/TypeScript app and the Rust core with the Android edition, with every
Android-only piece replaced by its iOS equivalent.

## What cannot be done here

iOS apps are built and signed only on macOS with Xcode. This port is written on
Windows, so:

- `src-tauri/gen/apple/` (the Xcode project) does not exist in this repo. It is
  generated on a Mac by `npx tauri ios init`.
- Nothing Swift or Rust-for-iOS is compiled or run.
- The two app extensions (widget, share) need their targets added by hand in
  Xcode; their Swift source is written here, their `.xcodeproj` wiring is not.

Verified here instead: `npm run typecheck`, `npx vitest run`, icon generation.
`BUILDING-ON-A-MAC.md` holds the exact remaining steps.

## Architecture

### The extension problem

On Android, `QuickNote.kt` and `DayReminders.kt` open `ember.db` with
`SQLiteDatabase` from a broadcast receiver and write straight into `captures`
and `checkins`. iOS forbids the equivalent: a widget, a Control Center control
and a share sheet are **app extensions** — separate processes with no Tauri
core, no Rust, no webview, and no access to the containing app's sandbox.

Rather than move the database into an App Group container (which would change
tauri-plugin-sql's path and complicate `VACUUM INTO`, restore, and migrations),
**no extension ever touches the database.** Two routes instead:

| Route | Surfaces | Mechanism |
|---|---|---|
| Open the app | widget tap, Control Center control, Shortcuts/Siri | `ember://note[?text=…]` URL → app opens the quick-note sheet |
| Inbox file | share sheet, notification text reply | one JSON object per line appended to `inbox.jsonl` in the App Group container |

The app drains the inbox on launch and on every resume: Rust command
`inbox_drain` reads and truncates the file and returns the lines; TypeScript
inserts them through the existing `src/db/captures.ts` and
`src/db/checkins.ts`. SQL stays inside `src/db/` — hard rule 2 holds.

Inbox line format (v1):

```json
{"v":1,"kind":"note","at":"2026-09-19T13:04:22.511+05:30","text":"…"}
{"v":1,"kind":"day","at":"…","point":"lunch","text":"…","skipped":false}
```

`kind:"note"` → a row in `captures`. `kind:"day"` → today's `checkins` row:
the point's time column and its stretch of `day_notes`, exactly as
`DayReminders.record()` does on Android.

### The bridge

`window.EmberAndroid` is deleted. WKWebView has no synchronous JavaScript →
native call, and three of its ten methods are synchronous (one is read during
`Settings` render). Replacements:

| Android method | iOS |
|---|---|
| `isQuickNoteEnabled` / `setQuickNoteEnabled` / `refreshQuickNote` | removed — iOS has no permanent drawer notification. The Settings toggle goes. |
| `setDayReminders` | TypeScript: `registerActionTypes` + `sendNotification` + `onAction` from tauri-plugin-notification |
| `backupCopySupported` | always true — every iPhone has a Files app |
| `backupSnapshotPath` | Rust command `backup_snapshot_path` |
| `saveBackupCopy` | Rust command `backup_save_copy` (writes to the app's Documents folder) |
| `restartApp` | removed — iOS forbids self-restart; the UI asks the user to reopen Ember |
| `pickBackup` | the existing non-Android branch of `backup.ts` (plugin-dialog + `backup_stage`) |

`src/androidBridge.ts` becomes `src/nativeBridge.ts`, exporting async functions
over Tauri commands.

### Day reminders in TypeScript

`registerActionTypes` with `input: true` is supported on mobile by
tauri-plugin-notification v2. Three reminders (lunch, break, dinner) are
scheduled a week ahead with `Schedule.at`, the same way the evening reminder
already is, and skipped for a day once that day's check-in already has the
point. `onAction` handles a reply while the app is alive; a reply arriving
while it is not is written to the inbox by `NotificationHandler.swift` and
drained on next open.

This removes the AlarmManager dependency entirely: no Swift needed for
Phase A's reminders except the killed-app reply handler.

### Backups

`Documents/Ember` on Android becomes the app's own Documents folder, exposed in
the Files app by `UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace`.
Restore already works through the dialog plugin. Restart after restore is not
possible, so `restorePickedBackup` shows "Close Ember and open it again".

### iCloud backup exclusion — required

iOS backs the whole app container up to iCloud by default. Android excluded
`secrets/` through `backup_rules.xml`. Without the equivalent:

1. API keys would leave the phone — breaks hard rule 1 (local-first & private).
2. `install_id` would travel with a restored journal, so `decideFirstRun`
   would never return `welcome-back` and a restored install would silently have
   no key.

Fix: `secret_path` marks the `secrets/` directory with
`NSURLIsExcludedFromBackupKey` on creation (Rust, via `objc2-foundation`, or
the `xattr` `com.apple.MobileBackup` flag). Also excluded: the staged-restore
file and `*.before-restore` copies.

### Safe areas

`MainActivity.kt`'s inset padding is replaced by `viewport-fit=cover` on the
viewport meta plus `env(safe-area-inset-*)` padding on the app shell. The
keyboard is handled by WKWebView's own resize behaviour plus
`interactive-widget=resizes-content`.

### The `pc` provider

Hidden for this edition. Removed from `PROVIDER_OPTIONS`, from `factory.ts`,
`budget.ts`, `reviewJobs.ts` and `Onboarding.tsx`; the "Sync with computer"
Settings section goes. `lan_client.rs`, `lan_proto.rs`, `src/lan/phoneLink.ts`,
`src/components/ComputerLinkSettings.tsx` and `src/ai/providers/pc.ts` move to
`trash/`. `src/db/sync.ts` and `src/lan/syncEvents.ts` stay: `backup.ts` uses
them and their tests still pass.

Consequence: this edition has **three** providers, not four. `CLAUDE.md` is
rewritten to say so, so hard rule 5 is not silently violated.

## Phases

**Phase A — the app.** Everything above. No new Xcode targets, so it has the
best chance of building first try on a Mac.

**Phase B — the extensions.** Widget + Control Center (one WidgetKit target),
Share extension (one target), App Group, App Intents for Shortcuts. Swift
source written here; targets added by hand in Xcode.

## Testing

Unchanged Vitest suites must still pass. New pure-logic tests:

- `planDayReminders` — which of the three points ring on which days
- inbox line parsing and dispatch (`src/inbox.test.ts`)
- `decideFirstRun` unchanged

UI and native behaviour are unverifiable from Windows and are listed as manual
checks in `BUILDING-ON-A-MAC.md`.
