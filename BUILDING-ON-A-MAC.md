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

`tauri ios init` writes `src-tauri/gen/apple/ember_ios_iOS/Info.plist`. Add
these keys. (Each one is needed by something in this repo; nothing else is.)

```xml
<!-- Backups: "Ember backup.db" shows up in Files > On My iPhone > Ember. -->
<key>UIFileSharingEnabled</key>
<true/>
<key>LSSupportsOpeningDocumentsInPlace</key>
<true/>

<!-- The widget, the Control Centre button and Shortcuts open ember://note. -->
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key>
    <string>dev.abhij.ember.ios</string>
    <key>CFBundleURLSchemes</key>
    <array><string>ember</string></array>
  </dict>
</array>
```

There is deliberately **no** `NSLocalNetworkUsageDescription` and **no** ATS
exception: this edition makes no home-network calls at all (see "The computer
link" below).

### The two calls in AppDelegate

Open `src-tauri/gen/apple/ember_ios_iOS/` and add the three Swift files from
`ios/App/` and `ios/Shared/` to the app target (drag them in, tick
"ember_ios_iOS"). Then, in the generated `main.swift` / `AppDelegate`:

```swift
// BEFORE ember_ios_lib's entry point runs:
EmberLaunch.pointRustAtSharedInbox()

// AFTER it has started (in applicationDidBecomeActive, say):
EmberLaunch.takeOverNotifications()

// And in application(_:open:options:):
if EmberLaunch.handle(url: url) { return true }
```

Phase A works without the first and third — day reminders answered on the lock
screen are the only thing that needs them, and only when Ember is closed.

### If the keyboard doesn't rise with the quick-note sheet

iOS only opens the keyboard for a focus that still belongs to the tap that
asked for it, and React's timing is just past that line. If the sheet comes up
without the keyboard, set this on the webview once, at startup:

```swift
// WKWebView, private but long-standing and App Store safe.
webView.configuration.setValue(false, forKey: "keyboardDisplayRequiresUserAction")
```

---

## Phase B — the widget, the Control Centre button and the share sheet

These are **app extensions**: separate programs with their own targets. Xcode
has to create the targets; the Swift inside them is written and waiting in
`ios/`.

### 1. The App Group

All three, plus the app, share one folder. In Xcode, for **each** of the three
targets: Signing & Capabilities → + Capability → App Groups → add

```
group.dev.abhij.ember.ios
```

If you change that name, change `EmberInbox.appGroup` in
`ios/Shared/EmberInbox.swift` to match.

Without the App Group nothing breaks — notes just stay in the extension and
never reach the journal — so get this right before testing.

### 2. EmberWidget (widget + Control Centre button)

File → New → Target → **Widget Extension**, named `EmberWidget`. Untick
"Include Configuration Intent". Then:

- Delete the sample Swift file Xcode generates.
- Add `ios/EmberWidget/EmberWidget.swift`, `ios/Shared/EmberInbox.swift` and
  `ios/Shared/EmberIntents.swift` to the target.
- Deployment target: **iOS 17.0** — not 16, like the app. From iOS 17 a widget
  must declare its own background, and `containerBackground` doesn't exist
  before that. (CI caught this.) The Control Centre button needs iOS 18 and
  switches itself off below that.

### 3. EmberShare (share sheet)

File → New → Target → **Share Extension**, named `EmberShare`. Then:

- Delete the generated `ShareViewController.swift` **and** `MainInterface.storyboard`.
- Add `ios/EmberShare/ShareViewController.swift` and `ios/Shared/EmberInbox.swift`.
- In `EmberShare/Info.plist`, replace `NSExtensionMainStoryboard` with:

```xml
<key>NSExtensionPrincipalClass</key>
<string>$(PRODUCT_MODULE_NAME).ShareViewController</string>
```

and set what it accepts:

```xml
<key>NSExtensionAttributes</key>
<dict>
  <key>NSExtensionActivationRule</key>
  <dict>
    <key>NSExtensionActivationSupportsText</key>
    <true/>
    <key>NSExtensionActivationSupportsWebURLWithMaxCount</key>
    <integer>1</integer>
  </dict>
</dict>
```

### 4. Shortcuts and Siri

Nothing to add: `ios/Shared/EmberIntents.swift` in the app target is enough.
Both actions appear in Shortcuts the first time the app is run.

---

## Checking it by hand

None of this can be tested from Windows. Walk through it on a real phone —
a simulator can't do notifications with text replies properly.

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

**Phase B**

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
