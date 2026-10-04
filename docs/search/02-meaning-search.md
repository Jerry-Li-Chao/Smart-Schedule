# Search, part 2 — search by meaning with embeddings

[Part 1](01-text-search.md) finds what you *typed*. This part finds what you *meant*:

| You search | It finds | Shared words |
|---|---|---|
| `teeth` | Call the dentist | none |
| `food shopping` | Grocery run | none |
| `save my computer files` | Back up laptop | none |
| `landlord email` | Reply to landlord | only one of two |
| `牙齿` (teeth) | 看牙医 (see the dentist) | none — and works across languages |

All of it runs on your computer, with a free model in Ollama. The code is
[`vectors.ts`](../../src/lib/search/vectors.ts) (~170 lines) and
[`hybrid.ts`](../../src/lib/search/hybrid.ts) (~40).

---

## The one idea: text → vector

An **embedding model** is a neural network trained to turn a piece of text into a list of numbers —
a **vector** — such that *texts with similar meaning get similar vectors*. Ours, `bge-m3`, outputs
1024 numbers per text:

```
"Call the dentist"  →  [ 0.021, -0.043, 0.118, …  (1024 numbers) ]
"teeth"             →  [ 0.019, -0.037, 0.101, … ]
"Buy groceries"     →  [-0.064,  0.012, 0.007, … ]
```

You can't read meaning from any single number. What matters is **direction**: think of each vector
as an arrow in a 1024-dimensional space. Arrows for "teeth" and "dentist" point roughly the same
way; "groceries" points elsewhere. The model learned this from enormous amounts of text in which
"teeth" and "dentist" keep appearing in similar contexts.

How "the same way" is measured: **cosine similarity**, the cosine of the angle between two arrows —
1 means the same direction, 0 means unrelated (at right angles).

```
cos(a, b) = (a · b) / (|a| × |b|)
```

A trick that makes this cheap: **normalize** every vector to length 1 when you store it. Then
`|a| × |b| = 1` and cosine similarity is just the dot product — 1024 multiplications and additions
([`normalizeVec`, `dot`](../../src/lib/search/vectors.ts)).

## Step 1 — Get vectors from the model

Ollama serves the model over HTTP with the same API shape as OpenAI:

```http
POST http://localhost:11434/v1/embeddings
{ "model": "bge-m3", "input": ["Call the dentist", "Buy groceries"] }

→ { "data": [ { "index": 0, "embedding": [ … 1024 numbers … ] }, { "index": 1, … } ] }
```

Sending several texts at once (a *batch*) is much faster than one at a time. Measured here: 10
texts in one request ≈ 145 ms; a single short query ≈ 20 ms once the model is loaded (the very first
request takes ~2 s while Ollama loads it into memory).

**Why bge-m3?** Embedding models differ in the languages they learned. A planner with English *and*
Chinese needs a *multilingual* model, in which "teeth" and "牙齿" land near each other. `bge-m3` is a
well-tested open one (~1.2 GB).

## Step 2 — Decide what to embed

Each document becomes one short text: title, notes, and context (project name, repeat rule)
([`embedText`](../../src/lib/search/vectors.ts)).

What we **leave out** matters as much. The first version also embedded the date and status
(`"Sat Jul 4 2026 · done"`). Measured:

| Document text | similarity to `teeth` |
|---|---|
| `Call the dentist` | **0.673** |
| `Call the dentist` + `Sat Jul 4 2026` + `done` | 0.551 |

The extra words dilute the meaning — the vector now also "means" a date. Dates and status are
better handled as exact filters ([part 1, step 6](01-text-search.md#step-6--understanding-the-query)),
so the vector only has to capture what the task is *about*.

## Step 3 — Build the index, once, incrementally

Embedding a few thousand tasks takes seconds, so it's done **ahead of time, in the background**,
and the vectors are stored in the browser's built-in database, **IndexedDB** — on this computer,
never synced. 1024 floats × 4 bytes ≈ 4 KB per task; 3,000 tasks ≈ 12 MB.

Keeping it current without redoing everything ([`syncIndex`](../../src/lib/search/vectors.ts)):

1. For each document, compute a quick **hash** of its embed text (FNV-1a — a few lines of code).
2. Compare with the stored hash. Same → nothing to do. Different or missing → embed it again.
3. Documents that no longer exist (deleted, ended) → remove their vectors.
4. Embed the to-do list in batches of 24, saving after each batch and reporting progress.

So the first run indexes everything (271 tasks: ~6 s here), and after that an edit costs one ~20 ms
call. The app runs this 2.5 s after the planner last changed ([`useSemanticIndex`](../../src/lib/search/useSemanticIndex.ts)),
so typing a task doesn't trigger it on every keystroke.

One rule: **vectors from different models can't be compared** — each model has its own "space".
The model's name is stored with every vector, and switching models clears the index.

## Step 4 — Search: embed the query, compare with everything

```ts
const [q] = await embed([query]);            // ~20 ms
for (const doc of docs) sim = dot(q, vec[doc]);   // 3,000 × 1024 multiply-adds ≈ 1–3 ms
```

That's **brute force** — comparing with every vector. You'll read about vector databases and
approximate nearest-neighbour indexes (HNSW, IVF…); they exist for *millions* of vectors. For a
few thousand, a plain loop is faster than the overhead of anything clever.

### Where to draw the line

Every document gets *some* similarity, so we need a cut-off. Measured on bge-m3 with task-sized
texts:

| Pairs | Similarity |
|---|---|
| related (`teeth` ↔ dentist, `trip to japan` ↔ Book flights to Tokyo, …) | 0.63 and up |
| unrelated | median 0.44, 97th percentile 0.55 |
| vague queries (`something about my car`) vs unrelated titles | up to ~0.61 |

So we keep matches ≥ **0.60**, and also drop anything more than 0.12 below the best match — once
there's a strong match, weak ones are just noise. These numbers are model-specific: a different
model needs its own measurement. The way these were found is simple and worth copying: embed ~10
tasks and ~10 queries whose right answers you know, print every similarity, and look at where the
related pairs and the unrelated pairs fall.

## Step 5 — Merge with text search (hybrid search)

Now there are two ranked lists: text matches (part 1) and meaning matches. Their scores can't be
compared — a text score of 9.3 and a cosine of 0.71 are on unrelated scales. **Reciprocal Rank
Fusion** sidesteps that by looking only at *positions* ([`hybrid.ts`](../../src/lib/search/hybrid.ts)):

```
score(doc) = Σ over the lists it appears in:  1 / (60 + its rank in that list)
```

- A document near the top of **both** lists beats one at the top of only one.
- Exact text matches stay strong; meaning-only finds slot in after them.
- The 60 dampens the difference between rank 1 and rank 2, so neither list dominates.

It's a few lines and works remarkably well — hybrid search with RRF is what many production search
systems use.

Results that only meaning found get a small **related** tag, so a loose guess is never presented
as a confident match.

## Step 6 — Feel instant

The panel shows text results on every keystroke (part 1 is ~1 ms). 220 ms after you *stop* typing
it asks the embedding model and merges the meaning results in — about 0.3 s from your last key to
the final list. If Ollama isn't running, the meaning results simply never arrive and text search
carries on alone.

---

## Try it

1. `ollama pull bge-m3`
2. Settings → **Search by meaning** → wait for "Ready — N items indexed".
3. ⌘K and search for something you'd *describe* rather than quote.

Then open the browser devtools → Application → IndexedDB → `planner-search` to see the stored
vectors.

## What meaning search can't do

It finds *things*. It can't answer "when did I last pay the car insurance?" or "what's left for the
kitchen project?" — those need something to read the results and reply. That's part 3: **Ask**,
retrieval-augmented generation with the local LLM.
