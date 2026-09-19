// Ember in Shortcuts and Siri, and the action behind the Control Centre
// button.
//
// Two actions:
//   - "Save a note in Ember" takes the words and writes them straight to the
//     shared inbox, without opening anything. Good for "Hey Siri, save a note
//     in Ember", for a Home Screen shortcut, and for automations.
//   - "Open an Ember note" leaves a line in the inbox saying "open the note
//     sheet", then opens Ember, which reads the inbox as soon as it is on
//     screen. This is what the widget and the Control Centre button run.
//
// Doing it with an intent rather than a URL matters: an intent runs code
// before the app opens, so the inbox is the only way a note ever travels, and
// Ember needs no URL scheme and nowhere to handle one - which is just as well,
// because a Tauri iOS app has no AppDelegate to handle it in.
//
// Added to the app target and to EmberWidget by scripts/xcode-extensions.py.

import AppIntents

@available(iOS 16.0, *)
struct SaveEmberNoteIntent: AppIntent {
  static var title: LocalizedStringResource = "Save a note in Ember"
  static var description = IntentDescription(
    "Writes a quick note into today's notes. Ember picks it up the next time you open it."
  )
  // Nothing to look at: the note is saved without the app coming forward.
  static var openAppWhenRun: Bool = false

  @Parameter(title: "Note", requestValueDialog: "What's on your mind?")
  var text: String

  static var parameterSummary: some ParameterSummary {
    Summary("Save \(\.$text) in Ember")
  }

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      return .result(dialog: "There was nothing to save.")
    }
    guard EmberInbox.note(trimmed) else {
      return .result(dialog: "Couldn't save that. Open Ember once, then try again.")
    }
    return .result(dialog: "Saved to today's notes.")
  }
}

@available(iOS 16.0, *)
struct OpenEmberNoteIntent: AppIntent {
  static var title: LocalizedStringResource = "Open an Ember note"
  static var description = IntentDescription("Opens Ember with the note sheet ready.")
  static var openAppWhenRun: Bool = true

  func perform() async throws -> some IntentResult {
    // The app reads this the moment its webview is on screen (src/inbox.ts).
    EmberInbox.openNote()
    return .result()
  }
}

/// Puts both actions in the Shortcuts gallery, with spoken phrases.
@available(iOS 16.0, *)
struct EmberShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: SaveEmberNoteIntent(),
      phrases: ["Save a note in \(.applicationName)", "Note this in \(.applicationName)"],
      shortTitle: "Save a note",
      systemImageName: "square.and.pencil"
    )
    AppShortcut(
      intent: OpenEmberNoteIntent(),
      phrases: ["Open a note in \(.applicationName)"],
      shortTitle: "Open a note",
      systemImageName: "book.closed"
    )
  }
}
