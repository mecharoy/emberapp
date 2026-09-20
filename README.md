# Ember

A journal that writes itself. Android and Windows.

Jot quick notes during the day (from the app, the notification drawer or a Quick Settings tile). In the evening Ember asks you a few questions about your day, then writes the entry for you on a handwritten page. Over time it picks up your moods, habits, sleep and the people and themes that keep coming up.

The Windows app can also pair with your phone over the same Wi-Fi: your journal syncs between the two, and either one can chat through a local model (via [Ollama](https://ollama.com)) running on the computer instead of an API key.

## Download

Grab the latest release for your platform from [Releases](https://github.com/mecharoy/emberapp/releases):

- **Android**: the `.apk`. Open it on your phone (you may need to allow installing from your browser or file manager).
- **Windows**: the `.exe` installer. It's unsigned, so Windows SmartScreen may warn you the first time — "More info" → "Run anyway".

Both apps check this repo for new versions and tell you when one is out.

## AI

Ember needs a way to talk to a model for the conversation and the writing. Any of:

- a free key from [Groq](https://console.groq.com/keys), [Google AI Studio](https://aistudio.google.com/apikey), [OpenRouter](https://openrouter.ai/keys), [Cerebras](https://cloud.cerebras.ai) or [Mistral](https://console.mistral.ai/api-keys),
- an [Anthropic](https://console.anthropic.com) key,
- an [OpenAI](https://platform.openai.com/api-keys) key, or
- on Windows, a local model through [Ollama](https://ollama.com) — nothing leaves your computer, and a paired phone can use it too.

Every model gets the same features, including the checklist Ember drafts before a conversation; free and local models work as well as the paid ones.

A key (when you use one) stays in the app's private storage. Your journal is a SQLite database on your device — no account, and no sync unless you pair a phone with the Windows app yourself. What you write in the conversation goes to the provider you picked. Export everything any time from Settings.

Ember is a reflection tool, not therapy.

## Build

The Android app builds from this repo. Needs Node 22+, Rust with the Android targets, JDK 17+ and the Android SDK/NDK.

```bash
npm ci
npx tauri android build --apk --split-per-abi -t aarch64
```

`npm test` runs the tests. `npm run tauri dev` opens the app in a desktop window.

The Windows app is a separate Tauri project; its source isn't in this repo yet.

## Feedback

Settings → Updates & feedback opens a GitHub issue here. Or just [open one](https://github.com/mecharoy/emberapp/issues).

## Credits

- WHO-5 Well-Being Index © World Health Organization, CC BY-NC-SA 3.0 IGO (non-commercial use).
- PHQ-9 and GAD-7 by Drs. Robert L. Spitzer, Janet B.W. Williams, Kurt Kroenke and colleagues, with an educational grant from Pfizer Inc.
- Fonts: Newsreader and Caveat (SIL Open Font License).

## License

[MIT](LICENSE)
