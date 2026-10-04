# Search, part 1 — fast, forgiving text search

This is the first of three layers behind the ⌘K search panel:

1. **Text search** (this page) — instant, no AI. Finds what you typed, even misspelled or half-typed.
2. **Meaning search** — finds things that *mean* the same as the query, using embeddings.
3. **Ask** — answers a question in words, using the local LLM and the results of 1 + 2 (RAG).

Layer 1 does most of the work, so it is worth understanding first. Everything here is ~300 lines in
[`src/lib/search/`](../../src/lib/search).

---

## The problem

You have a few thousand short texts (task titles, notes, project names) and a query like
`pasport` or `dentist next week`. You want the best matches in a few milliseconds, on every keystroke.

The naive approach — loop over every task and check `title.includes(query)` — fails in three ways:

| Query | Task | `includes` says |
|---|---|---|
| `pasport` | Renew passport | no match (typo) |
| `renewing` | Renew passport | no match (different word ending) |
| `call dentist` | Call the dentist | no match (words not adjacent) |

So instead we do what every search engine does: **break text into terms, index them, and score.**

---

## Step 1 — Documents

First, every task is flattened into a plain **document** with a few text fields
([`docs.ts`](../../src/lib/search/docs.ts)):

```ts
{ id, kind: 'task', title: 'Renew passport', notes: 'bring two photos',
  context: 'Travel · Every year on 3/1', date: '2026-09-15', status: 'open', … }
```

`context` holds information that isn't the task itself but helps you find it — the project name,
the repeat rule, "bill subscription" for anything with a cost. Deleted tasks and repeats that have
ended are left out here, once, so no later step has to think about them.

All three layers search these documents, never raw tasks.

## Step 2 — Terms (tokenizing)

A *tokenizer* turns text into **terms** ([`text.ts` → `tokenize`](../../src/lib/search/text.ts)):

1. **Normalize**: lower-case, strip accents (`é → e`), turn full-width characters into normal ones.
2. **Split** into words on anything that isn't a letter or digit.
3. **Stem**: chop common endings so related words become the same term —
   `renewals → renewal → renew`, `groceries → grocery`. Real stemmers (Porter, Snowball) have
   dozens of rules; for short task titles, a handful is enough. What matters is that the *same*
   function runs on both the documents and the query, so both sides agree.
4. **Chinese, Japanese, Korean** don't put spaces between words, so "words" can't be split on
   spaces. The trick: index every **character** *and* every **pair of adjacent characters**:

   ```
   看牙医  →  看, 牙, 医, 看牙, 牙医
   ```

   A query `牙医` (dentist) then matches on `牙`, `医` and the pair `牙医`. Pairs only add a bonus —
   they make "characters next to each other" rank above "characters scattered around".

## Step 3 — The inverted index

Instead of scanning every document per query, we build a map **from each term to the documents
that contain it** — an *inverted index* (the same structure behind every search engine):

```
"renew"    → { doc 0: 3 }
"passport" → { doc 0: 3 }
"photo"    → { doc 0: 1 }          ← from the notes, so a lower weight
"dentist"  → { doc 1: 3, doc 7: 3 }
```

The number is the **field weight**: a match in the title is worth 3, in the context 1.5, in the
notes 1, in the date words ("Tue Oct 6 2026") 0.5. A word in the title says more about a task than
the same word in its notes.

The index is rebuilt only when the planner changes, not on every keystroke. A query then only
touches the documents listed under its terms — which is why it stays fast as the planner grows.

## Step 4 — Matching forgivingly

Each query term is **expanded** into the index terms it could mean, each with a confidence factor
([`expand`](../../src/lib/search/text.ts)):

| Kind | Example | Factor |
|---|---|---|
| exact | `passport` → `passport` | 1.0 |
| word start | `pass` → `passport` | 0.75 |
| typo | `pasport` → `passport` | 0.6 |

Typos use **edit distance** — the minimum number of single-letter inserts, deletes, replacements
(and swaps of neighbouring letters) to turn one word into the other. `pasport → passport` is 1.
It's the classic dynamic-programming table:

```
        p  a  s  s  p  o  r  t
     0  1  2  3  4  5  6  7  8
  p  1  0  1  2  3  4  5  6  7
  a  2  1  0  1  2  3  4  5  6
  s  3  2  1  0  1  2  3  4  5
  p  4  3  2  1  1  1  2  3  4
  …                          1   ← bottom-right = distance
```

Two details keep it fast and sane: we allow 1 typo for words of 4–6 letters and 2 for longer
ones (short words have too many neighbours — "cat" is one edit from "car", "hat", "cut"…), and we
stop filling the table as soon as a whole row exceeds the limit.

## Step 5 — Scoring

For every document a query term reaches, it earns:

```
factor (exact/start/typo)  ×  IDF(term)  ×  field weight
```

**IDF** — *inverse document frequency* — is the key idea of classic search ranking:

```
IDF(term) = ln(1 + N / number of documents containing the term)
```

A term in 2 of 3,000 tasks (`passport`) is very informative; one in 900 of them (`call`) barely
tells you anything. IDF makes rare words count more. (This is the heart of TF-IDF and BM25, the
ranking functions behind most search engines; we skip term *frequency* because task titles are
too short for repetition to mean much.)

A document's score is the sum over the query terms. Then:

- **Coverage first**: results are ordered by *how many of the query words they matched*, then by
  score. A short query must match every word (`call dentist` shouldn't return every "call");
  longer queries need about 60% of their words.
- **A small recency nudge**: things near today get up to +20%, fading over a couple of months.
  Two equally good matches? You probably mean the one from last week.

## Step 6 — Understanding the query

Before searching, [`query.ts`](../../src/lib/search/query.ts) pulls out the parts of the query that
are really **filters**:

```
"done dentist last month"  →  text "dentist"  +  { status: done, from: 2026-09-01, to: 2026-09-30 }
```

It knows relative ranges (`today`, `last week`, `next month`, `this year`, `上个月`), months
(`in march`, `march 2025`), years, status words (`done`, `open`), importance (`must`) and `bills`.
Each pattern can decline a match — `may` is only a month in `in may` or `may 2026`, never in
"may need to call". The panel shows what it understood as chips, so it never feels like magic you
can't see.

## Step 7 — Showing results

The panel ([`SearchPanel.tsx`](../../src/components/SearchPanel.tsx)) highlights *whole words* that
matched — typing `pass` highlights all of "passport", which reads much better than half a word —
and when only the notes matched, shows that line of the notes under the title.

---

## Try it

```bash
npx vitest run src/lib/search
```

The tests in [`search.test.ts`](../../src/lib/search/search.test.ts) are small, readable examples
of every behaviour above. A good exercise: add a test for a query you think should work, see it
fail, and find which step needs to change.

## What text search can't do

Ask it for `car paperwork` when the task says "Renew vehicle registration", or `teeth` when it says
"dentist". No letters in common, so no amount of forgiveness helps. That's what part 2 —
**meaning search with embeddings** — is for.
