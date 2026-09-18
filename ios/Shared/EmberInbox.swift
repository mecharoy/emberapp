// The one place anything outside the app writes a note.
//
// A widget, a Control Centre button, the share sheet and a reminder answered
// on the lock screen all run in their own process on iOS. None of them can
// open ember.db. So each appends one line of JSON to a file in the shared
// App Group folder, and Ember empties that file whenever it next comes to the
// screen (src/inbox.ts, src-tauri/src/ios_extras.rs).
//
// Add this file to every target: the app, EmberWidget and EmberShare.

import Foundation

enum EmberInbox {
  /// Must match the App Group on every target and the one in
  /// BUILDING-ON-A-MAC.md.
  static let appGroup = "group.dev.abhij.ember.ios"

  static let fileName = "inbox.jsonl"

  /// The shared folder, or nil when the App Group isn't set up yet.
  static var containerURL: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
  }

  static var fileURL: URL? {
    containerURL?.appendingPathComponent(fileName)
  }

  /// Local wall-clock time with the offset spelled out -
  /// `2026-09-19T13:04:22.511+05:30`. The same shape as isoNowLocal() in
  /// src/time.ts, so notes sort and group by day exactly as the app's own do.
  static func isoNowLocal(_ date: Date = Date()) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSSZZZZZ"
    formatter.timeZone = TimeZone.current
    return formatter.string(from: date)
  }

  /// Appends one line. Never throws: a note that can't be written is worth
  /// less than a crash in a widget.
  @discardableResult
  static func append(_ object: [String: Any]) -> Bool {
    guard let url = fileURL,
          let data = try? JSONSerialization.data(withJSONObject: object, options: []),
          var line = String(data: data, encoding: .utf8)
    else { return false }

    // One object per line, so a half-written note can never swallow the next.
    line = line.replacingOccurrences(of: "\n", with: " ") + "\n"
    guard let bytes = line.data(using: .utf8) else { return false }

    let manager = FileManager.default
    if !manager.fileExists(atPath: url.path) {
      return manager.createFile(atPath: url.path, contents: bytes)
    }
    guard let handle = try? FileHandle(forWritingTo: url) else { return false }
    defer { try? handle.close() }
    do {
      try handle.seekToEnd()
      try handle.write(contentsOf: bytes)
      return true
    } catch {
      return false
    }
  }

  /// A quick note, exactly as the in-app sheet would have saved it.
  @discardableResult
  static func note(_ text: String, at date: Date = Date()) -> Bool {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return false }
    return append(["v": 1, "kind": "note", "at": isoNowLocal(date), "text": trimmed])
  }

  /// An answer to a lunch, break or dinner reminder. `point` is "lunch",
  /// "break" or "dinner" (see DAY_POINT_COPY in src/dayReminders.ts).
  @discardableResult
  static func dayAnswer(point: String, text: String, skipped: Bool, at date: Date = Date()) -> Bool {
    append([
      "v": 1,
      "kind": "day",
      "at": isoNowLocal(date),
      "point": point,
      "text": text.trimmingCharacters(in: .whitespacesAndNewlines),
      "skipped": skipped,
    ])
  }

  /// "Ember, open the note sheet." Used by the widget, the Control Centre
  /// button and the Shortcuts action, which open the app rather than writing
  /// a note themselves.
  @discardableResult
  static func openNote(at date: Date = Date()) -> Bool {
    append(["v": 1, "kind": "open", "at": isoNowLocal(date)])
  }
}
