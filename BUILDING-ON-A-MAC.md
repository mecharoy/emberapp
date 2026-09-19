# Building Ember for iPhone

This folder holds a complete iOS edition of Ember, written on Windows. A GitHub
Actions macOS runner builds it on every push to the `ios` branch, so it is
known to compile — but **nothing here has ever been run, and nothing is
signed.** What follows is every remaining step.

Read `WHAT-IS-UNVERIFIED.md` first if you want to know what is proven and what
is likely to need fixing.

---

## What you need

- A Mac with Xcode 15 or newer (Xcode 16 for the Control Centre button).
- An Apple Developer account. The free tier is enough for your own phone;
  a paid one ($99/year) is needed for TestFlight, the App Store, and for App
  Groups to work reliably.
- Rust, Node 20+, and the CocoaPods gem.

```sh
xcode-select --install
brew install cocoapods
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
```

---

## Phase A — the app itself

Everything except the widget and the share sheet. Try this first: it needs no
hand-editing in Xcode at all.

```sh
cd ember-ios
npm install
npm run typecheck        # must pass
npx vitest run           # must pass
npx tauri ios init
```

`tauri ios init` creates `src-tauri/gen/apple/`, which is not in this repo.
Then:

```sh
npx tauri ios dev         # on a simulator or a plugged-in phone
npx tauri ios build        # a release .ipa
```

### Info.plist

`tauri ios init` writes `src-tauri/gen/apple/ember-ios_iOS/Info.plist`. Two
keys are needed, both so backups show up in the Files app:

```xml
<key>UIFileSharingEnabled</key>
<true/>
<key>LSSupportsOpeningDocumentsInPlace</key>
<true/>
```

There is deliberately **no** `NSLocalNetworkUsageDescription` and **no** ATS
exception: this edition makes no home-network calls at all (see "The computer
link" below). There is no `CFBundleURLTypes` either — nothing opens Ember by
URL; see below.

### There is no AppDelegate

Worth knowing before you go looking for one. `tauri ios init` generates a
single entry point:

```objc
// src-tauri/gen/apple/Sources/ember-ios/main.mm
int main(int argc, char * argv[]) { ffi::start_app(); return 0; }
```

Tauri builds the UIApplication and its delegate from inside Rust. There is no
`application(_:didFinishLaunchingWithOptions:)` to add a line to, and no
`application(_:open:options:)` either. Two consequences shape the whole port:

1. **Nothing opens Ember by URL.** The widget, the Control Centre button and
   the Shortcuts action all run an App Intent instead, and an App Intent runs
   code *before* the app comes forward — so it writes its line to the shared
   inbox itself. One mechanism carries every note from everywhere, and no URL
   scheme is needed.
2. **The App Group path reaches Rust through `+load`.** The Objective-C
   runtime calls `+load` when the image is loaded, before `main()`, which is
   early enough. That is all `ios/App/EmberBootstrap.mm` does.

## Phase B — the widget, the Control Centre button and the share sheet

These are **app extensions**: separate programs with their own targets. This
used to be a list of things to click in Xcode. It isn't any more.

`tauri ios init` doesn't hand-write an `.xcodeproj` — it writes an XcodeGen
spec, `src-tauri/gen/apple/project.yml`, and generates the project from it. So
one script adds the targets, the App Group and the embedding:

```sh
brew install xcodegen
pip3 install pyyaml

npx tauri ios init                       # writes project.yml
python3 scripts/xcode-extensions.py      # adds the two targets to it
cd src-tauri/gen/apple && xcodegen generate --spec project.yml && cd -

npx tauri ios build                      # or `dev`
```

That gives you `EmberWidget` (the Home Screen widget and the Control Centre
button, iOS 17+) and `EmberShare` (the share sheet), both carrying the App
Group `group.dev.abhij.ember.ios`, both embedded in `Ember.app/PlugIns`. CI
does exactly this and fails if either `.appex` is missing from the bundle.

To change the App Group name, change it in `scripts/xcode-extensions.py` and
in `EmberInbox.appGroup` in `ios/Shared/EmberInbox.swift` — they must match.

Run the script with `--no-extensions` to build the app on its own.

### Signing the extensions

An App Group needs a provisioning profile that grants it, so for a **device**
build each of the three bundle ids needs one in your Apple Developer account:

```
dev.abhij.ember.ios
dev.abhij.ember.ios.widget
dev.abhij.ember.ios.share
```

Simulator builds need none of this, which is why CI can check the whole thing
without an Apple account. Without the App Group the app still runs: notes
written inside Ember work as normal, and notes from an extension simply never
arrive.

### Shortcuts and Siri

Nothing extra to do: `ios/Shared/EmberIntents.swift` is in the app target, so
both actions appear in Shortcuts the first time Ember runs.

### If the keyboard doesn't rise with the quick-note sheet

iOS only opens the keyboard for a focus that still belongs to the tap that
asked for it, and React's timing is just past that line. If the sheet comes up
without the keyboard, set this on the webview once, at startup:

```swift
// WKWebView, private but long-standing and App Store safe.
webView.configuration.setValue(false, forKey: "keyboardDisplayRequiresUserAction")
```

---

## Checking it by hand

CI already does a fair amount of this: it boots a simulator, launches Ember,
checks it didn't crash and that all fourteen migrations ran, then writes a line
into the inbox by hand and confirms the note reaches the journal. What follows
is what a machine can't check.

**Phase A**

- [ ] The app opens on the Today tab, paper colour running under the notch and
      the home indicator, with nothing readable underneath either.
- [ ] Setup offers three providers: free hosted, Anthropic, OpenAI. No
      "Computer".
- [ ] A key saves, and "Test connection" passes.
- [ ] The quick-note sheet rises with the keyboard already up.
- [ ] A swipe in from the left edge closes the sheet, then an open entry, then
      goes back to Today — never straight out of the app.
- [ ] Settings › Data › "Back up now" writes "Ember backup.db" where the
      Files app shows it under On My iPhone › Ember.
- [ ] "Restore backup" picks that file, shows what's in it, restores, and then
      asks you to close Ember and open it again. Doing so shows the journal.
- [ ] Settings › You › "Remind me at these times", with a time a minute or two
      ahead: the reminder arrives, pulls down to show a text field and a
      "Not today" button.
- [ ] Type into the reminder **with Ember open**: it lands in today's check-in,
      under what you did that stretch of the day.
- [ ] Type into it **with Ember closed** (swipe it away first): open Ember
      afterwards and the same thing is there.
- [ ] Turn off the reminders: no more arrive.
- [ ] The evening reminder still arrives at its time.

**Phase B** — all of this needs the App Group, which is the one part of the
port CI cannot check: a simulator grants no App Group without a provisioning
profile, so on a build server Ember always falls back to its own folder. On a
device it shouldn't. Check it first, because everything else here depends on
it:

- [ ] Share some text to Ember, then open Ember. If the note is there, the App
      Group works and the rest of this list is worth doing. If it isn't, fix
      the provisioning profiles (see "Signing the extensions") before going on.

- [ ] The Ember widget can be added to the Home Screen and opens the note sheet.
- [ ] Control Centre (iOS 18+) offers an "Ember note" button that does the same.
- [ ] Sharing selected text from Safari or Notes to Ember says "Saved to
      today's notes", and the note is on the Today tab next time Ember opens.
- [ ] "Hey Siri, save a note in Ember" asks what's on your mind and saves it.
- [ ] The Shortcuts app lists both Ember actions.

**Privacy — worth checking once**

- [ ] Settings › your name › iCloud › Manage Account Storage › Backups › this
      phone › Ember: it should be listed, and small (the journal, not the keys).
- [ ] After restoring the phone from an iCloud backup, Ember should ask for the
      API key again on a "Welcome back" screen. That is the sign the key was
      correctly left out of the backup.

---

## The computer link

The Android edition can pair with Ember on a computer over Wi-Fi and use its
AI. That is switched off here, so this edition has **three** AI providers, not
four. `ios/`, `src/` and `src-tauri/` contain none of the networking code; it
is in `trash/lan/` and `trash/rust/` if it is ever wanted.

Turning it back on would need `NSLocalNetworkUsageDescription`,
`NSBonjourServices`, an ATS exception for plain HTTP on the local network, and
Apple's Local Network permission prompt on first use.
