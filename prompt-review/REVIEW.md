# Where Ember's prompts break on a 4B local model

Companion to `PROMPTS.md`, which has every prompt as the model receives it.
Nothing under `src/ai/` was changed to write this. Token figures are chars ÷ 3.7,
good enough for budget arithmetic and no more.

## First, the premise

The brief for this review assumed two versions of each prompt, a big-model one
and a small-model one, that might have drifted apart. There aren't two versions.
`src/ai/prompts/` holds exactly one copy of each prompt, and `getProvider()` in
`src/ai/factory.ts` hands the same strings to Claude Sonnet, to a hosted 27B, and
to whatever Ollama is running on the paired Windows machine. So there is no drift
to measure in that sense. The real finding is the one underneath the question:
a single set of prompts, written at a level a large model handles comfortably,
is being sent unchanged to a 4B model, and several of them are too big to fit.

There is drift, though, between the prompts themselves — five different phrasings
of one grounding rule, two different JSON conventions. That's at the end.

## The overflow is the story, not the wording

`DEFAULT_NUM_CTX` is 8192 (`src/ai/providers/ollama.ts:15`). The file's own comment
explains why Ollama's native `/api/chat` is used at all: a prompt longer than the
context "is cut from the front without an error". Now the arithmetic on the evening
conversation, with every layer at the budget the code already permits:

    static skeleton, no user data          ~2,300 tokens    28% of the window
    journals budget  (24,000 chars)        ~6,500 tokens    79%
    documents budget (40,000 chars)       ~10,800 tokens   132%
    full system prompt at budget          ~22,600 tokens   276%

That is roughly 14,400 tokens over an 8192 window before the user has said a word,
and the overflow is taken off the front — the identity line, the style block the
user chose, and the whole `WHAT YOU KNOW` section, while `HARD RULES`, the crisis
rule and the marker protocols survive at the tail. A user with a few reference
documents and a fortnight of unsummarised entries gets an Ember that has forgotten
who it is but still remembers how to write a reminder marker.

The comment at `src/ai/documents.ts:8-9` says the document budget "keeps small local
models from silently dropping the start of an oversized prompt". It doesn't: 40,000
chars is on its own 1.3× the default window. The budget was set against a hosted
model's context and never revisited for the local path.

The fix is to derive the budgets from `num_ctx` instead of fixing them in chars.
Something like: reserve the measured skeleton (~2,300), leave a quarter of the
window for the conversation to grow into, and split what's left between documents
and journals. At 8192 that lands near 4,400 chars of documents and 6,600 of
journals — a real cut, but a quiet truncation is worse than a visible one, and
`formatDocumentsForPrompt` already names what it dropped so the model can say so
honestly. At a 32k window the same formula gives back everything today's constants
allow.

One thing I could not check: `createOllamaProvider` is called for the `pc` provider
without a `numCtx` (`src/ai/factory.ts:26`), and the comment says the computer
replaces the context size with its own. The desktop app isn't in this repo, so
whether a phone-driven session actually runs at 8192 or at something larger is
your call to confirm. If the desktop does raise it, most of this section becomes a
question of how much, not whether.

## The reminder marker quietly lies

This is the highest-severity behavioural risk, and it is specific to weak models.

The counselor prompt asks the model to resolve "tomorrow at 10" or "in two hours"
into `YYYY-MM-DDTHH:MM` from a date line and an `HH:MM` clock. That's date
arithmetic, which is among the first things a 4B model gets wrong. Meanwhile
`src/ai/reminders.ts` validates each marker and silently strips the malformed and
the past-dated ones, deliberately — a streamed turn can't be re-run without
disrupting the conversation.

Put those together and the failure is: the model says "I'll nudge you tomorrow at
10:00", the marker it emitted was `2026-07-10` when today was `2026-07-11`, the
marker is stripped, the user is told a reminder exists, and no reminder exists.
Nothing surfaces. On a big model this is rare enough to live with. On a 4B model
it will be common.

The cheapest fix removes the arithmetic rather than asking the model to do it
better. Have the app put the dates in the turn preamble, where they cost about ten
tokens, and let the model copy:

    [SESSION STATE — from the app, not from them: the time right now is 21:15;
    today is 2026-07-09, tomorrow is 2026-07-10; you are 3 exchanges into
    tonight's session; their session length preference is standard — around
    8-10 exchanges.]

and in the REMINDERS block, replace

    - Resolve relative times ("tomorrow at 10", "in two hours") from tonight's
      date above and the current time in this turn's SESSION STATE line.

with

    - Build the date from the SESSION STATE line: "tomorrow at 10" is that
      line's tomorrow date and 10:00. For "in two hours", add to the time in
      that line. Never write a date that is not today's or tomorrow's unless
      they named a specific day.

That covers the overwhelming majority of real reminders without any arithmetic at
all. Worth pairing with a code change: when a marker is stripped as invalid,
it would be better to drop the sentence that promised it than to leave the promise
standing, though that is harder than it sounds on a streamed reply.

## The commented JSON will break the extractor

`EXTRACTOR_SYSTEM_PROMPT` and `JOURNAL_SYSTEM_PROMPT` both teach their output shape
as a JSON object with `//` comments inside it. The other three — review, fortnightly,
monthly — use clean JSON and put the rules in prose above. That inconsistency
matters more than it looks.

A large model reads a commented example as documentation. A small model reads it as
a template and copies the shape it was shown, comments included. `extractJson`
(`src/ai/json.ts`) does a bare `JSON.parse` after stripping a code fence, and `//`
is not valid JSON, so the parse throws, the single retry fires with the same
commented example still in the system prompt, and the day's extraction fails
outright. The extractor's shape block is 5,057 chars across 47 comment lines, and
54% of it is comment rather than JSON.

The change is to follow what review, fortnightly and monthly already do: state the
shape clean, and move the rules above it as prose. For the extractor that means
replacing the commented object with something like

    {
      "mood": 6, "energy": 4, "sleep_hours": 6.5,
      "summary_line": "...",
      "themes": [{"key": "...", "sentiment": 0.0}],
      "habits": [{"key": "...", "done": true}],
      "people": [{"key": "...", "sentiment": 0.0}],
      "emotions": ["..."], "emotions_named": ["..."],
      "strengths_shown": ["..."], "struggles_shown": ["..."],
      "activities": [{"key": "...", "pleasure": 0, "mastery": 0}],
      "thinking_traps": [{"type": "...", "quote": "..."}],
      "rhythm": {"first_contact": "08:30", "work_start": "09:15", "dinner": "20:00"}
    }

with every rule that currently lives in a comment moved into a prose block above it,
and one line the current prompt lacks:

    The numbers in the shape above are an example of the format, not defaults.
    Read each one from the day.

That last line matters because small models copy literal example values. `"mood": 6`
sitting in the template is a standing invitation to return 6 every day, and since
mood drives most of the Insights charts, a flat line at 6 would look like data
rather than a bug.

## One mistyped field throws away the whole day

Not a wording problem, but it decides how much the wording problems cost, so it
belongs here. I ran the real schema against the mistakes a 4B model actually makes
(`src/ai/extractor.ts:41`):

    mood as the string "6"          FAIL — whole extraction thrown away
    mood 0, just out of range       FAIL — whole extraction thrown away
    themes as ["thesis"]            FAIL — whole extraction thrown away
    habits done as "true"           FAIL — whole extraction thrown away
    mood absent entirely            PASS
    activities malformed            PASS — degrades, rest survives
    thinking_traps malformed        PASS — degrades, rest survives

The three fields carrying `.catch()` degrade gracefully. The core fields carry
`.default()`, which only fills a *missing* key and does nothing for a wrongly typed
one. So the comment at line 30, about not wasting the retry "when mood, themes and
habits came back fine", protects exactly the reverse of the common case: a stringy
`"6"` in an otherwise perfect object discards mood, energy, sleep, themes, habits,
people, emotions and both quote lists.

Adding `.catch(null)` to the scalars and `.catch([])` to the arrays would turn a
total loss into a partial one. On a big model this almost never fires. On a 4B model
it is the difference between an Insights tab that fills slowly and one that stays
empty with no error anywhere.

## The counselor prompt asks for too many things at once

About 2,300 tokens of standing instruction: a nine-item private checklist, a
five-stage session flow, seven named question types, a dig-versus-move-on rule,
six hard rules, two marker protocols, and a tone and approach pair. A 4B model
holds three to five active constraints. It will comply with whatever it saw most
recently and drop the rest, and since `HARD RULES` sits in the middle, the rules
most likely to go are the ones that shape every single message: one question per
message, one to three sentences, walk the day in order before going deep.

I'd add a short closing block, after `WRAPPING UP`, restating only the invariants.
Recency is the cheapest lever there is on a small model, and this costs about
sixty tokens:

    BEFORE EVERY REPLY
    One question, not two. One to three sentences.
    Reflect what they said, then ask.
    If a part of their day is still uncovered, ask about that part.
    Say only what is in WHAT YOU KNOW or what they just told you.

While there: the rendered prompt carries 17 hard negations ("never", "don't"), and
36 counting the softer ones, where small models follow positive instructions
markedly better. The most load-bearing one is worth
inverting. "Never open with 'how was your day'" tells the model what not to write
without telling it what to write; "Open by naming the first part of the day by its
times and one note from it" gets the same result by describing the target. The
same applies to "never recite or summarise it back to them" on the journals layer,
which would be better as "refer to a recent entry only when tonight touches it,
in half a sentence".

## A cut-off journal reads as a crash

`JOB_REPLY_TOKENS.journal` is 1200 and the prompt asks for 200–450 words of
narrative plus a title, two to five highlights and a counselor note. At the top of
that range the reply is around 800 tokens, so the headroom is real but not large,
and small models follow word counts badly. When one over-runs, `done_reason` comes
back `"length"` and `ollama.ts:120` throws "The reply was cut off before it was
finished", losing the entire entry.

Word counts are the wrong unit for a small model. "200-450 words" would do better
as a shape it can see itself producing — "four to six short paragraphs, shorter
when the material is thin" — and the same applies to the weekly letter's 80–180
words and the monthly's 100–180.

## Thinking is off for jobs nobody is watching

`createOllamaProvider` sets `think: false` for every call, and the comment
(`ollama.ts:57-60`) justifies it with a measured three minutes before the first
visible word of a chat opening line. That reasoning is sound for the conversation
and doesn't transfer to the background jobs, where nothing is on screen and a
minute of silent reasoning costs nobody anything.

The extractor's twelve-key schema and the monthly formulation's five headings with
dated evidence are precisely the tasks where a 4B model benefits most from being
allowed to think. Letting `think` follow the call site rather than the provider —
off for `chatStream`, on for `complete` — is a small change with a real chance of
moving extraction quality on weak models. Worth measuring before committing to it,
since `stripReasoning` would then be doing real work on every job.

## Drift between the prompts

Smaller, but it's the part of the original question that does have an answer.

The grounding rule is stated five different ways: "Never invent events, feelings,
or details that weren't there" (journal), "You never invent: every value must be
grounded in something actually written, said or entered" (extractor), "Ground
everything in the data provided. Never invent events." (review), "Never invent.
Every statement must come from the previous summary or the new entries." (memory),
"Ground everything in the data. Never invent events." (monthly). The JSON preamble
has three variants of the same sentence about code fences and commentary. Two
prompts comment their JSON and three don't.

None of this is wrong, and on a big model none of it matters. It's worth
consolidating anyway, because the moment there's a shared `GROUNDING` and
`JSON_ONLY` constant, tuning that wording for weak models is one edit in one place
instead of five edits that will drift again. That's the change I'd make first if
you decide to go after the 4B path properly, since every other wording fix here
gets cheaper once it exists.

## If you only do three things

Cut the document and journal budgets to fit `num_ctx`, because everything else is
moot when the front of the prompt is being silently discarded. Strip the comments
out of the extractor and journal JSON examples, because that one is close to free
and it's the difference between an Insights tab that fills and one that doesn't.
Put tomorrow's date in the turn preamble, because a reminder the app promised and
didn't set is the failure a user would actually notice and lose trust over.
