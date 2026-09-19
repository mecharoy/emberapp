# Why these two files were put aside

Both were written on the assumption that a Tauri iOS app has an AppDelegate to
add code to. It doesn't. `tauri ios init` generates one entry point:

```objc
// src-tauri/gen/apple/Sources/ember-ios/main.mm
#include "bindings/bindings.h"
int main(int argc, char * argv[]) {
    ffi::start_app();
    return 0;
}
```

Tauri creates the UIApplication and its delegate from inside Rust. There is no
`application(_:didFinishLaunchingWithOptions:)` in the project to edit, so
`BUILDING-ON-A-MAC.md`'s old "add these two calls to AppDelegate" step was
describing something that doesn't exist.

## EmberLaunch.swift

Three jobs, all now done elsewhere:

- **the App Group path** → `ios/App/EmberBootstrap.mm`, which uses `+load`.
  The Objective-C runtime calls that before `main()`, which needs no delegate.
- **installing a notification delegate** → dropped, see below.
- **handling `ember://note`** → dropped. The widget, the Control Centre button
  and the Shortcuts action all run an App Intent, and an App Intent can write
  the inbox line itself before the app opens. No URL scheme is needed at all,
  which also removed `CFBundleURLTypes` and any need for a deep-link plugin.

## EmberNotificationHandler.swift

This would have caught a day reminder answered while Ember was closed and
written it to the inbox. Two problems:

1. There is nowhere to install it from. It needs to slide in front of the
   delegate tauri-plugin-notification sets up, and that happens inside Rust
   after `start_app()`, with no hook in between.
2. Even if there were, two handlers for one reply is a way to save the same
   note twice.

So a reply is handled by the notification plugin's own `onAction`, which
`src/dayReminders.ts` already listens to. Whether iOS delivers that to a
webview that isn't running yet is the open question, and it is written down as
such in `WHAT-IS-UNVERIFIED.md`. If cold-start replies turn out to be lost,
this file is the starting point — but it would need a Tauri iOS plugin
(`src-tauri/ios/`, a Swift package Tauri loads) rather than a loose file.
