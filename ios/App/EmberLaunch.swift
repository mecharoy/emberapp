// Two small jobs the app does at launch, before and around Tauri.
//
// Add this file to the app target only. BUILDING-ON-A-MAC.md says where the
// two calls go in the generated AppDelegate.

import Foundation
import UIKit
import UserNotifications

enum EmberLaunch {
  /// Tells the Rust side where the shared inbox is.
  ///
  /// The App Group folder is only reachable through Foundation, so Rust can't
  /// find it on its own; it reads this environment variable instead
  /// (inbox_path in src-tauri/src/ios_extras.rs). Must run before Tauri
  /// starts. Without an App Group this does nothing, and Ember falls back to
  /// its own folder - notes typed inside the app still work, notes from the
  /// widget and the share sheet don't arrive.
  static func pointRustAtSharedInbox() {
    guard let url = EmberInbox.fileURL else { return }
    setenv("EMBER_INBOX_PATH", url.path, 1)
  }

  /// Ember answers its own reminders even when it isn't running. Call this
  /// after Tauri has started, so it slides in front of the notification
  /// plugin's own handler rather than replacing it.
  static func takeOverNotifications() {
    EmberNotificationHandler.install()
  }

  /// A tap on the widget, the Control Centre button or the Shortcuts action
  /// opens `ember://note`. All Ember has to do is remember why it was opened;
  /// the webview reads the inbox as soon as it is on screen and opens the
  /// note sheet (src/inbox.ts, src/App.tsx).
  @discardableResult
  static func handle(url: URL) -> Bool {
    guard url.scheme == "ember" else { return false }
    // ember://note, or ember://note?text=... from a Shortcut that already has
    // the words.
    guard url.host == "note" else { return false }

    let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
    let text = items.first(where: { $0.name == "text" })?.value ?? ""
    if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      EmberInbox.openNote()
    } else {
      EmberInbox.note(text)
    }
    return true
  }
}
