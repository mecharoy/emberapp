// Answering a lunch, break or dinner reminder from the lock screen.
//
// The reminders are scheduled in TypeScript (src/dayReminders.ts), and a reply
// that arrives while Ember is on screen is saved there too, through the
// notification plugin's own onAction. This file is only for the other case:
// iOS woke the app just to hand over the reply, the webview doesn't exist, and
// nothing can touch the database. The answer goes into the shared inbox and is
// saved the next time Ember opens.
//
// Both paths must never run for the same reply, or the note would be written
// twice. The rule is the app's state: awake and on screen means the webview is
// there and the plugin's own handler deals with it; anything else means this
// file does. Whatever the plugin installed stays in place and is handed every
// response either way, so nothing else the plugin does is lost.
//
// Add this file to the app target only.

import Foundation
import UIKit
import UserNotifications

final class EmberNotificationHandler: NSObject, UNUserNotificationCenterDelegate {
  static let shared = EmberNotificationHandler()

  /// Whatever tauri-plugin-notification put there before us.
  private weak var pluginDelegate: UNUserNotificationCenterDelegate?

  /// Slides in in front of the plugin's delegate. Call it after Tauri has
  /// started, so the plugin has already installed its own.
  static func install() {
    let center = UNUserNotificationCenter.current()
    let existing = center.delegate
    if existing === shared { return }
    shared.pluginDelegate = existing
    center.delegate = shared
  }

  /// Matches DAY_ACTION_TYPE in src/dayReminders.ts.
  private static let dayActionType = "ember-day-point"
  private static let replyAction = "reply"
  private static let skipAction = "skip"

  /// Matches the id scheme in src/dayReminders.ts: 5100 + point * 10 + day.
  private static let dayIdBase = 5100
  private static let points = ["lunch", "break", "dinner"]

  /// Which point a notification belongs to: from the note Ember attached when
  /// it scheduled the reminder, or failing that from the id it was given.
  private func point(for notification: UNNotification) -> String? {
    let info = notification.request.content.userInfo
    if let tagged = info["emberDayPoint"] as? String, Self.points.contains(tagged) {
      return tagged
    }
    // tauri-plugin-notification files the whole options object under "extra".
    if let extra = info["extra"] as? [String: Any],
       let tagged = extra["emberDayPoint"] as? String,
       Self.points.contains(tagged) {
      return tagged
    }
    guard let id = Int(notification.request.identifier) else { return nil }
    let offset = id - Self.dayIdBase
    guard offset >= 0, offset < Self.points.count * 10 else { return nil }
    return Self.points[offset / 10]
  }

  // Ember is on screen: let the plugin decide, and show the reminder anyway
  // rather than swallowing it.
  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    if let plugin = pluginDelegate,
       plugin.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:willPresent:withCompletionHandler:))) {
      plugin.userNotificationCenter?(center, willPresent: notification, withCompletionHandler: completionHandler)
      return
    }
    completionHandler([.banner, .sound, .list])
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let webviewIsUp = UIApplication.shared.applicationState == .active
    if !webviewIsUp {
      saveToInbox(response)
    }

    if let plugin = pluginDelegate,
       plugin.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:didReceive:withCompletionHandler:))) {
      plugin.userNotificationCenter?(center, didReceive: response, withCompletionHandler: completionHandler)
    } else {
      completionHandler()
    }
  }

  private func saveToInbox(_ response: UNNotificationResponse) {
    let content = response.notification.request.content
    guard content.categoryIdentifier == Self.dayActionType,
          let point = point(for: response.notification)
    else { return }

    switch response.actionIdentifier {
    case Self.replyAction:
      guard let typed = (response as? UNTextInputNotificationResponse)?.userText,
            !typed.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      else { return }
      EmberInbox.dayAnswer(point: point, text: typed, skipped: false)
    case Self.skipAction:
      EmberInbox.dayAnswer(point: point, text: "", skipped: true)
    default:
      // The notification itself was tapped, or dismissed: that just opens
      // Ember, and the evening's check-in asks the same question anyway.
      return
    }
  }
}
