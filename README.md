# Ember for iPhone

A journal that writes itself.

Jot quick notes during the day — from the app, a Home Screen widget, the
Control Centre button, the share sheet in any other app, or by asking Siri. In
the evening Ember asks you a few questions about your day, then writes the
entry for you on a handwritten page. Over time it picks up your moods, habits,
sleep and the people and themes that keep coming up.

This is the iPhone edition, copied from the Android one on 2026-09-19. The
Android and Windows versions live alongside it in `ember-mobile` and
`ember-desktop`.

## It compiles; it has never been run

Written on Windows, where iOS code can't be built. A GitHub Actions macOS
runner now builds it on every push to the `ios` branch, so the Rust, the Swift
and the Xcode project are all known to compile — and the run leaves a real
`Ember.app` behind as an artifact.

Nothing has ever been *launched*, on a phone or a simulator, and nothing has
been signed. Everything you can see or touch is still unverified.

- `BUILDING-ON-A-MAC.md` — every remaining step, plus a by-hand test checklist.
- `WHAT-IS-UNVERIFIED.md` — exactly what is proven and what isn't.
- `.github/workflows/ios.yml` — the build.

## AI

Ember needs a way to talk to a model for the conversation and the writing.
On iPhone, any of:

- a free key from [Groq](https://console.groq.com/keys),
  [Google AI Studio](https://aistudio.google.com/apikey),
  [OpenRouter](https://openrouter.ai/keys),
  [Cerebras](https://cloud.cerebras.ai) or
  [Mistral](https://console.mistral.ai/api-keys),
- an [Anthropic](https://console.anthropic.com) key, or
- an [OpenAI](https://platform.openai.com/api-keys) key.

The Android edition can also borrow the AI of a paired Windows computer over
the same Wi-Fi. That is not offered here.

Your key stays in the app's private storage, marked so that it never reaches
iCloud. Your journal is a SQLite database on your phone — no account, no sync.
What you write in the conversation goes to the provider you picked. Export
everything any time from Settings, or keep a daily copy in the Files app.

Ember is a reflection tool, not therapy.

## Build

Needs Node 22+ and Rust; anything past `npm run build` needs a Mac with Xcode
and CocoaPods.

```bash
npm ci
npm run typecheck     # must pass
npx vitest run        # must pass
npx tauri ios init    # macOS only, from here on
npx tauri ios dev
```

`npm run tauri dev` opens the app in a desktop window on any platform, which is
enough for most UI work. Nothing iOS-specific runs there: the widget, the share
sheet, the day reminders and the backup copies all need a real phone.

## Feedback

Settings → Updates & feedback opens a GitHub issue. Or just
[open one](https://github.com/mecharoy/emberapp/issues).

## Credits

- WHO-5 Well-Being Index © World Health Organization, CC BY-NC-SA 3.0 IGO (non-commercial use).
- PHQ-9 and GAD-7 by Drs. Robert L. Spitzer, Janet B.W. Williams, Kurt Kroenke and colleagues, with an educational grant from Pfizer Inc.
- Fonts: Newsreader and Caveat (SIL Open Font License).

## License

[MIT](LICENSE)
