# How ⌘K search works

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
