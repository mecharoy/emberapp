# CLAUDE.md — Ember for iPhone

Ember for iPhone (ember-ios) is the iOS edition of the local-first Ember
journaling companion, copied from ember-mobile (the Android edition) on
2026-09-19. The user drops quick notes during the day, has a short
counselor-style AI conversation in the evening, and the AI writes the journal
entry and tracks patterns over time. The full product spec is in `DESIGN.md` —
read it before any feature work.

**It compiles; it has never been run.** iOS builds only on macOS, so a GitHub
Actions macOS runner does it on every push to the `ios` branch
(`.github/workflows/ios.yml`): the Rust for a real iPhone, every Swift file in
`ios/`, `tauri ios init`, and a full simulator build. Push there before
claiming any Rust or Swift change works.

Nothing has ever been launched, on a phone or a simulator, and nothing is
signed. Never say an iOS *behaviour* works — compiling isn't running.
`BUILDING-ON-A-MAC.md` has the remaining steps and the by-hand checklist;
`WHAT-IS-UNVERIFIED.md` says exactly what is proven.

## Stack

- Tauri 2 (Rust core) + React 18 + TypeScript (strict) + Vite + Tailwind CSS
- SQLite via tauri-plugin-sql; Recharts for charts
- AI: provider abstraction in `src/ai/` — **three** providers on the phone: an
  Anthropic API key, an OpenAI API key, or a hosted free-tier endpoint
  (`cloud`: Groq/Gemini/OpenRouter…, via `providers/openaiCompatible.ts`).
  The Android edition's fourth provider, `pc` (the AI of a paired computer over
  Wi-Fi), is **not offered here**; its code is in `trash/lan/` and
  `trash/rust/`. Hard rule 5 below is about these three.
  A new cloud host must be added to the http allowlist in
  `src-tauri/capabilities/default.json` as well, or its requests are blocked.
- Day reminders at the usual lunch/break/dinner times are scheduled in
  TypeScript (`src/dayReminders.ts`) through tauri-plugin-notification, with a
  text field in the notification. A reply while the app is open is saved there;
  a reply while it's closed goes through the inbox (below).
- **The inbox** (`src/inbox.ts`, `src-tauri/src/ios_extras.rs`,
  `ios/Shared/EmberInbox.swift`): iOS app extensions are separate processes
  with no Rust, no webview and no way into ember.db. So the widget, the
  Control Centre button, the share sheet and lock-screen replies each append
  one JSON line to a file in the App Group folder, and the app drains it on
  launch and on every resume. **Never give an extension database access** —
  that would mean moving ember.db into the App Group container and is not worth
  it.
- Native Swift lives in `ios/`, outside the generated Xcode project, and is
  added to targets by hand. `src-tauri/gen/apple` is Mac-generated and is not
  committed.

- Context budget (`src/ai/budget.ts`): big models get everything; small ones (free hosted)
  get compact mode: `prepare.ts` writes a briefing + checklist, `prompts/counselorCompact.ts`,
  memory lines picked by `relevance.ts` from `memoryFiles.ts`, a rolling chat summary (`window.ts`), and
  Insights in smaller steps (`prompts/extractorCompact.ts`, `compactDays.ts`, counted links in `insights/links.ts`).
  All prompts, filled in, are in `../prompt-review/PROMPTS.md` (regenerate: EMBER_PROMPT_REVIEW=1 npx vitest run
  src/ai/prompts/promptReview.test.ts, desktop).

## Commands

- `npm run tauri dev` — run the app in a desktop window (works on Windows; no
  native iOS behaviour)
- `npm run typecheck` — `tsc --noEmit` (must pass before any commit)
- `npx vitest run` — the test suite (must pass before any commit)
- `npx tauri ios init` / `npx tauri ios dev` / `npx tauri ios build` — **macOS only**

## Layout

```
src/
  ai/          provider layer, prompt builders, context assembly, extraction
  db/          typed data access, migrations — the ONLY place SQL lives
  windows/     main window pages (Today, Journal, Insights, Settings)
  components/  shared UI
  inbox.ts     notes caught while the app was closed
  dayReminders.ts  lunch/break/dinner reminders and their replies
  nativeBridge.ts  the Tauri commands that replaced window.EmberAndroid
ios/           Swift added to the Xcode project by hand (see BUILDING-ON-A-MAC.md)
  Shared/      EmberInbox.swift, EmberIntents.swift — app AND extensions
  App/         app target only
  EmberWidget/ widget + Control Centre button
  EmberShare/  share sheet
src-tauri/     Rust: migrations, plugins, private API-key store, ios_extras.rs
trash/         Android and computer-link code, kept rather than deleted
```

## Hard rules

1. **Local-first & private.** No telemetry, no analytics, no network calls
   except the configured AI endpoint and the update check (one GitHub request
   at launch, switchable off; DESIGN.md §3.5). This edition makes **no**
   home-network calls at all. Never log message content, captures, or entries.
   Never write the API key anywhere except its designated store (the
   app-private secrets folder via secret_get/secret_set), which is marked
   "don't back this up" so it never reaches iCloud — see `exclude_from_backup`
   in `src-tauri/src/ios_extras.rs`. Notification text is never anything the
   user wrote.
2. **SQL only in `src/db/`.** Components call typed functions. Schema changes
   go through numbered migrations — never edit an applied migration. This
   holds for the inbox too: extensions write JSON lines, never SQL.
3. **All model output that must be structured is validated** (zod), retried
   once with the parse error appended, then degraded gracefully. A model
   failure must never lose user data or block saving an entry.
4. **Prompts live in code as exported template functions** in `src/ai/prompts/`,
   one file per job (counselor, journal, extractor, review). They are product
   surface — change them only when asked, and keep DESIGN.md §5 as the source
   of truth for their contracts.
5. **Provider-agnostic:** every AI feature must work on all three providers.
   If a feature relies on a capability one provider lacks, stop and flag it.
6. **Dates:** store ISO 8601 local time; a "day" is the user's local calendar
   day. Session/entry uniqueness is per local date. Swift writes the same shape
   — `EmberInbox.isoNowLocal()` mirrors `isoNowLocal()` in `src/time.ts`.

## Design language

- A paper journal: warm off-white paper, ink-dark text, the Newsreader serif
  (bundled, never fetched) for headings, entries and Ember's words, the system
  sans for controls. One accent, ember orange-red, used sparingly. Hairline
  rules and spacing instead of boxes; no emoji icons, glows or blur. Colors
  are the named tokens in tailwind.config.js (paper, rule, ink, ember) and the
  validated chart palette in src/components/insights/palette.ts.
- The page runs edge to edge under the notch and the home indicator; nothing
  readable or tappable does. Safe areas are CSS (`--safe-*` in `src/index.css`,
  `viewport-fit=cover` in `index.html`), not native padding.
- Motion is small and purposeful (page fade-in, ink-in for new messages, the
  breathing ember while Ember thinks) and switches off under reduced motion.
- No gamification noise beyond the small streak counter.
- The quick-note sheet must feel instant: no spinners, keyboard up at once.
- The journal entry is a handwritten page (Caveat, bundled) on ruled paper;
  papers and their contrast-checked inks live in src/components/paper.ts.
- Empty states are friendly and explain the daily loop in one line.
- Chat renders streaming tokens; never block the UI on a full response.

## Testing expectations

- Vitest for: db access functions (against a temp sqlite file), prompt
  builders (snapshot the assembled context), extractor validation/retry
  logic, streak calculation, observation upsert math, the day-reminder plan
  and the inbox line format.
- UI, Swift and anything iOS is verified by hand on a real phone, against the
  checklist in `BUILDING-ON-A-MAC.md` — say explicitly which items you
  verified and how. Never say an iOS behaviour works unless it was run on a
  device.

## Plain language

Write replies a smart person outside my field could follow on first read. No
jargon, no buzzwords, no invented compound terms. If a technical term is
unavoidable, gloss it in plain words the first time. Short sentences, one idea
each — no nested clauses or hedging chains. Prefer the common word over the
impressive one. Say the thing directly instead of describing that you are about
to say it.
