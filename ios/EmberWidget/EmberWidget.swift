// The Home Screen widget and the Control Centre button.
//
// Neither can hold a text field, and neither can reach ember.db, so both do
// the same thing: open Ember at `ember://note`, which opens the quick-note
// sheet with the keyboard already up (EmberLaunch.swift -> src/inbox.ts ->
// src/App.tsx). This is the closest iPhone gets to Android's notification
// drawer note and Quick Settings tile.
//
// Add this file to the EmberWidget target only. EmberInbox.swift goes in that
// target too.

import SwiftUI
import WidgetKit

private let paper = Color(red: 0.965, green: 0.945, blue: 0.906)  // #F6F1E7
private let ink = Color(red: 0.157, green: 0.137, blue: 0.118)    // #28231E
private let inkFaint = Color(red: 0.463, green: 0.424, blue: 0.376) // #766C60
private let ember = Color(red: 0.702, green: 0.267, blue: 0.102)  // #B3441A

private let noteURL = URL(string: "ember://note")!

// ---------- Home Screen widget ----------

struct EmberEntry: TimelineEntry {
  let date: Date
}

struct EmberProvider: TimelineProvider {
  func placeholder(in context: Context) -> EmberEntry { EmberEntry(date: Date()) }

  func getSnapshot(in context: Context, completion: @escaping (EmberEntry) -> Void) {
    completion(EmberEntry(date: Date()))
  }

  // Nothing on the widget changes, so one entry that never expires is enough:
  // no refresh budget spent, nothing private ever drawn on the Home Screen.
  func getTimeline(in context: Context, completion: @escaping (Timeline<EmberEntry>) -> Void) {
    completion(Timeline(entries: [EmberEntry(date: Date())], policy: .never))
  }
}

struct EmberWidgetView: View {
  @Environment(\.widgetFamily) private var family

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text("Ember")
        .font(.system(size: 13, weight: .semibold, design: .serif))
        .foregroundStyle(ember)
      Text(family == .systemSmall ? "A quick note" : "Something happened? Jot it down.")
        .font(.system(size: family == .systemSmall ? 17 : 19, design: .serif))
        .foregroundStyle(ink)
        .lineLimit(2)
        .minimumScaleFactor(0.8)
      Spacer(minLength: 0)
      Text("Tap to write")
        .font(.system(size: 12))
        .foregroundStyle(inkFaint)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .containerBackground(paper, for: .widget)
    .widgetURL(noteURL)
  }
}

struct EmberWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "dev.abhij.ember.ios.note", provider: EmberProvider()) { _ in
      EmberWidgetView()
    }
    .configurationDisplayName("Ember note")
    .description("Opens Ember with the note sheet ready.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

// ---------- Control Centre button (iOS 18 and newer) ----------
//
// The nearest thing iPhone has to Android's Quick Settings tile. It lives in
// this same target; on iOS 17 it simply isn't offered.

@available(iOS 18.0, *)
struct EmberNoteControl: ControlWidget {
  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: "dev.abhij.ember.ios.control") {
      ControlWidgetButton(action: OpenEmberNoteIntent()) {
        Label("Ember note", systemImage: "square.and.pencil")
      }
    }
    .displayName("Ember note")
    .description("Opens Ember with the note sheet ready.")
  }
}

// ---------- the bundle ----------

@main
struct EmberWidgetBundle: WidgetBundle {
  var body: some Widget {
    EmberWidget()
    if #available(iOS 18.0, *) {
      EmberNoteControl()
    }
  }
}
