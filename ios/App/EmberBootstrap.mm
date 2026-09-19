// Telling the Rust side where the shared inbox is.
//
// This is the only native code the app target needs, and it exists because of
// one fact about a Tauri iOS app: there is no AppDelegate to hook. The
// generated entry point is `main.mm`, and all it does is call into Rust:
//
//     int main(int argc, char *argv[]) { ffi::start_app(); return 0; }
//
// Tauri builds the UIApplication and its delegate from inside Rust, so there
// is nowhere to add "run this at launch" Swift. `+load` is: the Objective-C
// runtime calls it when the image is loaded, before main(), which is exactly
// early enough for an environment variable Rust reads later.
//
// The App Group folder — where the widget, the Control Centre button and the
// share sheet leave notes — can only be found through Foundation, so Rust
// can't find it on its own. It reads EMBER_INBOX_PATH instead (inbox_path in
// src-tauri/src/ios_extras.rs). Without an App Group this quietly does
// nothing, and Ember falls back to its own folder: notes written inside the
// app still work, notes from an extension never arrive.
//
// Added to the app target by scripts/xcode-extensions.py.

#import <Foundation/Foundation.h>
#include <stdlib.h>

/// Must match EmberInbox.appGroup in ios/Shared/EmberInbox.swift.
static NSString *const kEmberAppGroup = @"group.dev.abhij.ember.ios";

@interface EmberBootstrap : NSObject
@end

@implementation EmberBootstrap

+ (void)load {
  @autoreleasepool {
    NSURL *container = [[NSFileManager defaultManager]
        containerURLForSecurityApplicationGroupIdentifier:kEmberAppGroup];
    if (container == nil) {
      // No App Group on this build. Rust falls back to the app's own folder.
      return;
    }
    NSString *path = [[container URLByAppendingPathComponent:@"inbox.jsonl"] path];
    if (path.length == 0) {
      return;
    }
    setenv("EMBER_INBOX_PATH", path.UTF8String, 1);
  }
}

@end
