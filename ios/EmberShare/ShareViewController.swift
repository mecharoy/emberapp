// "Share to Ember" from any app.
//
// Select a line in a book, a message, a web page - the share sheet offers
// Ember, and the words land in today's notes. The extension can't reach
// ember.db, so it writes to the shared inbox and Ember picks it up next time
// it opens (src/inbox.ts).
//
// A plain sheet, not the system's compose view: the note is saved as it is,
// with nothing to fill in, which is the whole point of a quick note.
//
// Add this file to the EmberShare target only. EmberInbox.swift goes in that
// target too.

import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
  private let label = UILabel()

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor(red: 0.988, green: 0.976, blue: 0.953, alpha: 1)  // #FCF9F3

    label.translatesAutoresizingMaskIntoConstraints = false
    label.textAlignment = .center
    label.numberOfLines = 2
    label.font = UIFont(name: "Georgia", size: 19) ?? UIFont.systemFont(ofSize: 19)
    label.textColor = UIColor(red: 0.157, green: 0.137, blue: 0.118, alpha: 1)  // #28231E
    label.text = "Saving to Ember…"
    view.addSubview(label)
    NSLayoutConstraint.activate([
      label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      label.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
      label.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),
    ])
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    Task { await handleShare() }
  }

  private func handleShare() async {
    let text = await sharedText()
    let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""

    if trimmed.isEmpty {
      finish(saying: "Nothing to save.")
    } else if EmberInbox.note(trimmed) {
      finish(saying: "Saved to today's notes.")
    } else {
      finish(saying: "Couldn't save. Open Ember once first.")
    }
  }

  /// The shared words: plain text if there is any, otherwise the address of
  /// the page being shared.
  private func sharedText() async -> String? {
    guard let items = extensionContext?.inputItems as? [NSExtensionItem] else { return nil }
    for item in items {
      for provider in item.attachments ?? [] {
        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
           let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
          return text
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
           let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL {
          return url.absoluteString
        }
      }
      if let text = item.attributedContentText?.string, !text.isEmpty {
        return text
      }
    }
    return nil
  }

  /// Says what happened, briefly, then gets out of the way.
  private func finish(saying message: String) {
    label.text = message
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { [weak self] in
      self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
  }
}
