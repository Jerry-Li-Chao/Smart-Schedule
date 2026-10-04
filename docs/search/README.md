# How ⌘K search works

**Start here: [the interactive tutorial](tutorial.html).**

How to open it: the simplest way is to double-click `tutorial.html`. If Ollama refuses connections
from a local file (it may), the page shows measured numbers instead of live ones. For live results
with your models, run the dev server from the **project root** — the folder that contains
`package.json`, two levels up from this one (not `docs/search/`):

```bash
cd path/to/Smart-Schedule   # the repo root, where package.json is
npm run dev
```

then open <http://localhost:5173/docs/search/tutorial.html>. A dot in the top bar shows whether
it's connected to Ollama.

The same material as text:

Three layers, each a short tutorial for people who know programming but haven't built search or
used embeddings and LLMs before:

1. **[Text search](01-text-search.md)** — tokenizing, an inverted index, typo tolerance with edit
   distance, IDF scoring, and turning "last month" into a filter. Instant, no AI.
2. **[Meaning search](02-meaning-search.md)** — embeddings, cosine similarity, an incremental
   vector index in IndexedDB, picking a cut-off from measurements, and merging two result lists with
   Reciprocal Rank Fusion.
3. **[Ask](03-ask.md)** — retrieval-augmented generation: what the LLM should read, why the code
   should do the date maths, streaming, and keeping answers honest.

Each layer works without the next: no local AI → text search alone; no chat model → search without
answers.
