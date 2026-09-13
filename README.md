# Ember

A journal that writes itself. Android app.

Jot quick notes during the day (from the app, the notification drawer or a Quick Settings tile). In the evening Ember asks you a few questions about your day, then writes the entry for you on a handwritten page. Over time it picks up your moods, habits, sleep and the people and themes that keep coming up.

## Download

Grab the latest APK from [Releases](https://github.com/mecharoy/emberapp/releases) and open it on your phone (you may need to allow installing from your browser or file manager). The app checks this repo for new versions and tells you when one is out.

## AI

Ember needs an API key for the conversation and the writing. Either:

- a free key from [Groq](https://console.groq.com/keys), [Google AI Studio](https://aistudio.google.com/apikey), [OpenRouter](https://openrouter.ai/keys), [Cerebras](https://cloud.cerebras.ai) or [Mistral](https://console.mistral.ai/api-keys), or
- an [Anthropic](https://console.anthropic.com) key.

The key stays in the app's private storage. Your journal is a SQLite database on the phone, no account and no sync. What you write in the conversation goes to the provider you picked. Export everything any time from Settings.

Ember is a reflection tool, not therapy.

## Build

Needs Node 22+, Rust with the Android targets, JDK 17+ and the Android SDK/NDK.

```bash
npm ci
npx tauri android build --apk --split-per-abi -t aarch64
```

`npm test` runs the tests. `npm run tauri dev` opens the app in a desktop window.

## Feedback

Settings → Updates & feedback opens a GitHub issue here. Or just [open one](https://github.com/mecharoy/emberapp/issues).

## Credits

- WHO-5 Well-Being Index © World Health Organization, CC BY-NC-SA 3.0 IGO (non-commercial use).
- PHQ-9 and GAD-7 by Drs. Robert L. Spitzer, Janet B.W. Williams, Kurt Kroenke and colleagues, with an educational grant from Pfizer Inc.
- Fonts: Newsreader and Caveat (SIL Open Font License).

## License

[MIT](LICENSE)
