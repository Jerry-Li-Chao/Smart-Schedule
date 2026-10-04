# Search, part 3 — Ask: answering questions with RAG

Parts [1](01-text-search.md) and [2](02-meaning-search.md) *find* things. This part *answers*:

> **when is my next dentist appointment?**
> Your next dentist appointment is on Monday, October 5, 2026 **[10]**.  · 1.8 s

The `[10]` is a link to the task the answer came from. Everything runs on your computer with the
local LLM (here `qwen3.5:4b` in Ollama). The code: [`ask.ts`](../../src/lib/search/ask.ts) (what
the model reads), [`askLlm.ts`](../../src/lib/search/askLlm.ts) (talking to it) and the answer card
in [`SearchPanel.tsx`](../../src/components/SearchPanel.tsx).

---

## The idea: retrieve, then generate (RAG)

An LLM knows nothing about *your* planner. The obvious fix — paste the whole planner into the
prompt — is slow (thousands of tasks = a very long prompt for a small local model to read) and
makes answers worse (the relevant three lines drown in noise).

**Retrieval-augmented generation** splits the job:

```
question ──► [ retrieve ]  layers 1 + 2 pick the ~12 most relevant items
                 │
                 ▼
          [ prepare ]     turn them into a short numbered list, dates worked out
                 │
                 ▼
          [ generate ]    the LLM reads only that list and answers, citing [n]
```

The model's job shrinks from "know my life" to "read twelve lines and summarise" — which small
models are genuinely good at.

## Step 1 — When to answer

Answering costs a second or two of model time, so the panel only answers by itself when the query
*reads like a question* ([`isQuestion`](../../src/lib/search/ask.ts)): it ends with `?`, starts
with a question word (`when`, `what`, `did`, `any`, `how`, …), or contains a Chinese question
word (`什么`, `吗`, `几`, `有没有`, …). Everything else gets an **Ask** button (or ⌘↵) — because
"kitchen renovation" can be a question too, and only you know.

## Step 2 — Retrieve

The question goes through the *same* search as everything else, with two adjustments that matter
for questions:

- **Stop words.** Part 1 requires every word of a short query to match. "when did I last pay rent"
  would then require a task containing "when", "did" and "I". So filler words are dropped first
  ([`dropStopWords`](../../src/lib/search/text.ts)) — the query that's matched is "pay rent".
- **Filters still apply.** "what bills are coming up?" becomes *bills* + *next 30 days*. If no task
  matches the remaining words, the answer reads whatever fits the filters instead.

Meaning search (part 2) is especially useful here: "when is my next **dentist appointment**" has no
task with both words, but meaning search finds "Doctor appointment" and "Call the dentist".

## Step 3 — Prepare what the model reads

This is the step that decides answer quality. The first version handed the model the 12 items in
*relevance* order:

```
[1] Call the dentist — Fri Sep 4 2026 — done
[2] Call the dentist — Sun Sep 13 2026 — done
…
Question: when did I last go to the dentist?
```

and `qwen3.5:4b` answered **Sep 4** — consistently wrong, even after adding "20 days ago" /
"29 days ago" to each line. Small models are good readers and poor calculators: comparing dates
across a list is exactly the kind of reasoning they fumble.

The fix is to **do the reasoning in code and let the model read the answer off the page**
([`buildContext`](../../src/lib/search/ask.ts)):

```
Past (newest first):
[1] Call the dentist — Sun Sep 13 2026 (20 days ago) — done
[2] Call the dentist — Fri Sep 4 2026 (29 days ago) — done
Today and later (soonest first):
[3] Dentist appointment — Mon Oct 5 2026 (in 2 days) — open, must
Repeating:
[4] Pay rent — every month on the 1st — $1850 — next Sun Nov 1 2026 (in 29 days)
```

Now "last" is the first line under *Past* and "next" is the first under *Today and later*. Same
model, same question: right answer, every run. Other preparation choices:

- Relative dates (`in 2 days`, `3 days overdue`) are computed in code.
- Repeats get their **next** date and **last done** date computed from the repeat rule.
- Notes are trimmed to 160 characters; at most 12 items. Shorter prompt = faster answer.
- Items are **numbered**, and the code remembers which number is which task — that's how `[10]`
  becomes a link.

The instructions ([`systemPrompt`](../../src/lib/search/askLlm.ts)) are short and specific:
use only the items, 1–3 sentences, in the question's language, cite like `[2]`, copy dates as
written, and say so plainly when the items don't answer it. Temperature 0 makes the model pick
its most likely wording, so the same question gives the same answer.

## Step 4 — Make it feel fast

Measured with `qwen3.5:4b` on this machine:

| | Time |
|---|---|
| First question after the model was idle (loading it) | ~7 s |
| A full answer, model already loaded | ~1.1 s |
| **First words, streaming** | **~0.07 s** |

Three things turn that into "fast":

1. **Warm-up.** Opening ⌘K sends the model a one-token request, so it's loaded by the time you've
   typed a question ([`warmUp`](../../src/lib/search/askLlm.ts)).
2. **Streaming.** With `"stream": true` the server sends the answer as it's generated, as
   *server-sent events* — lines like `data: {"choices":[{"delta":{"content":"Your next"}}]}` —
   and the card shows each piece as it arrives ([`parseSSE`](../../src/lib/search/ask.ts)). A
   network chunk can end mid-line, so the parser keeps the unfinished tail for the next chunk.
   In the desktop app the request runs in Electron's main process (no browser restrictions), which
   forwards each chunk to the page over IPC.
3. **Never wait on the slow part.** The answer starts once meaning results are in *or* after about
   a second, whichever comes first; an earlier version waited on a slow embedding call and showed
   nothing for 10 s. The search results themselves appear instantly, so there's always something
   on screen.

Plus housekeeping: typing something new cancels the answer in progress (an `AbortController`),
and the same question over the same items is answered from a cache.

## Step 5 — Keep it honest

- Every answer is built only from the listed items, and cites them — you can check in one click.
- The card says it's from your local AI and can be wrong.
- When nothing relevant was found, the model is told so and says it can't answer, instead of
  inventing something.
- Nothing leaves the computer: retrieval, embeddings and the LLM all run locally.

---

## Try it

1. Turn on the local AI in Settings (and *Search by meaning* for better retrieval).
2. ⌘K → `when did I last …?`, `what bills are coming up?`, `what's left for <a project>?`
3. Type something that isn't a question and press **Ask** (⌘↵).

To see exactly what the model reads, call `buildContext` in the tests
([`search.test.ts`](../../src/lib/search/search.test.ts) has an example) — or temporarily
`console.log(ctx.text)` in `ask()` in the panel. Changing the layout of that text and watching the
answers change is the fastest way to build intuition for RAG.

## Where to go from here

- **Better retrieval beats a bigger model.** If an answer is wrong, first check whether the right
  item was among the 12 — usually the fix is in parts 1–2 or in how the list is laid out.
- **Re-ranking:** ask a model to re-order the top 30 candidates before taking 12.
- **Tool use:** for questions like "how much did I spend on subscriptions this year", let the
  model call a function that does the sum, instead of adding numbers itself.
